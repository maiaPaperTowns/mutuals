/*
 * mutuals: your pocket-sized networking companion, native on the FREE-WILi OG display CPU.
 *
 *   Screen (see native/make_assets.py): logo, the pup, a title + detail line, ★ points · Lv · progress bar, and
 *   MENU BACK YES NEXT NO labels sitting right above the five physical buttons.
 *
 *   MAP MODE: with the mutuals map website open and the badge connected (Web Serial over this CPU's USB), the pup
 *   follows your spot on the map: asleep while you're not discoverable, looking while nobody's near, excited with
 *   the nearest person's name + distance when someone is, "you found them!" when they're right here. YES / NO turn
 *   location sharing on / off on the website. Finding someone new earns points on the website (+10 nearby,
 *   +50 found), which the badge shows; levels go Lv 1 → Lv 5 and your home-screen pup grows up with you.
 *
 *   PRACTICE (no website for 5 s): match prompts pop up (quietly: LEDs only); YES in time = "it's mutual!" +10 pts,
 *   NO or too slow = "too slow". After 2 misses in a row the prompts stop until you press a button, so an idle
 *   badge stays calm. NEXT calls the next match now, YES on the home screen says hi. Points sync both ways: the
 *   website keeps the higher total, so practice points carry over.
 *
 *   MENU = stats (people met, matches caught, points, level), MENU / BACK closes it.
 *   Holding the red button (NO) for 6 s still powers the board off (FWOG_POWER_DEFAULT), so NO is a short tap.
 *
 * Built with the FREE-WILi wiliOGbsp (see native/build.sh).
 */
#include <stdio.h>
#include <string.h>
#include "fwog_display.h"
#include "hardware/pio.h"
#include "pico/stdlib.h"
#include "photon_assets.h"
#include "photon_sounds.h"

FWOG_POWER_DEFAULT();

#define RGB565(r, g, b) ((uint16_t)((((r) & 0xF8) << 8) | (((g) & 0xFC) << 3) | ((b) >> 3)))
#define NAVY RGB565(36, 40, 74)
#define MUTED RGB565(110, 108, 140)
#define BAR_FILL RGB565(92, 184, 138)

#define PROMPT_MS 2000u
#define RESULT_MS 1600u
#define SOCIAL_FADE_MS 25000u
#define FRAME_MS 330u
#define LEVELUP_MS 2800u
#define STATS_MS 10000u
#define MAP_TIMEOUT_MS 5000u
#define MAX_SOCIAL 4
#define PTS_CATCH 10
#define IDLE_MISSES 2          /* missed prompts in a row before practice pauses */
#define NEAR_SOUND_GAP_MS 45000u /* GPS drift can flicker someone in and out of range: chime at most this often */

/* ---- points & levels (same table as the website: map/src/points.ts) ---- */
static const int LEVEL_AT[5] = {0, 50, 100, 200, 400};
static const char *const LEVEL_NAME[5] = {"New here!", "Getting out there!", "Making connections!",
                                          "People magnet!", "Legend!"};
static int points, met, caught;
static int misses;  /* practice prompts in a row nobody answered */

static int level_of(int p) {
    int l = 1;
    for (int i = 1; i < 5; ++i) if (p >= LEVEL_AT[i]) l = i + 1;
    return l;
}

static unsigned level_progress_1024(int p) {  /* how far into the current level, 0..1024 */
    const int l = level_of(p);
    if (l == 5) return 1024u;
    return (unsigned)((p - LEVEL_AT[l - 1]) * 1024 / (LEVEL_AT[l] - LEVEL_AT[l - 1]));
}

/* ---- LEDs ---- */
static bool leds_ok, audio_ok;

static void led_all(uint8_t r, uint8_t g, uint8_t b) {
    if (!leds_ok) return;
    for (unsigned i = 0; i < FWOG_LED_COUNT; ++i) ws2812_set_color(i, r, g, b);
    ws2812_process();
}

static void led_progress(void) {  /* the LED strip is the level bar: lit = progress to the next level */
    if (!leds_ok) return;
    const unsigned lit = (level_progress_1024(points) * FWOG_LED_COUNT + 512u) / 1024u;
    for (unsigned i = 0; i < FWOG_LED_COUNT; ++i)
        ws2812_set_color(i, i < lit ? 40 : 6, i < lit ? 200 : 8, i < lit ? 110 : 10);
    ws2812_process();
}

static void led_rainbow(unsigned shift) {
    static const uint8_t c[7][3] = {{255, 60, 60}, {255, 150, 0}, {255, 230, 0}, {60, 220, 120},
                                    {70, 150, 255}, {150, 110, 255}, {255, 90, 200}};
    if (!leds_ok) return;
    for (unsigned i = 0; i < FWOG_LED_COUNT; ++i) {
        const uint8_t *k = c[(i + shift) % 7];
        ws2812_set_color(i, k[0], k[1], k[2]);
    }
    ws2812_process();
}

/* ---- sound: synthesized chiptune + puppy + voice clips (native/make_sounds.py) ---- */
static void play(const int16_t *clip, unsigned n) {
    if (!audio_ok) return;
    if (!i2s_audio_is_idle()) i2s_audio_stop();  /* a new event cuts off the old sound */
    i2s_audio_start(clip, n, true, false);
}

/* ---- screen ---- */
static void draw_background(void) {
    st7789_set_window(0, 0, 320, 240);
    st7789_blit(photon_background_px, 320u * 240u);
}

static void draw_sprite(photon_sprite_id_t s, unsigned frame) {
    const photon_sprite_t *sp = &photon_sprites[s];
    st7789_set_window(PHOTON_TILE_X, PHOTON_TILE_Y, PHOTON_TILE_W, PHOTON_TILE_H);
    st7789_blit(sp->tiles[frame % sp->tile_count], PHOTON_TILE_W * PHOTON_TILE_H);
}

/* Live text: rows of the background copied into RAM, anti-aliased glyphs blended on, then blitted. */
#define BUF_Y0 20u
#define BUF_ROWS 182u  /* rows 20..201: everything between the status bar and the button row */
static uint16_t buf[320u * BUF_ROWS];
static unsigned band_y, band_h;

static void band_begin(unsigned y, unsigned h) {
    st7789_dma_wait();  /* the buffer may still be on its way to the panel */
    band_y = y, band_h = h;
    memcpy(buf, photon_background_px + y * 320u, 320u * h * sizeof buf[0]);
}

static void band_end(void) {
    st7789_set_window(0, band_y, 320, band_h);
    st7789_blit(buf, 320u * band_h);
}

static uint16_t blend565(uint16_t bg, uint16_t fg, unsigned a /* 0..15 */) {
    const unsigned br = bg >> 11, bgg = (bg >> 5) & 63, bb = bg & 31;
    const unsigned fr = fg >> 11, fgg = (fg >> 5) & 63, fb = fg & 31;
    return (uint16_t)(((br * (15 - a) + fr * a) / 15) << 11 | ((bgg * (15 - a) + fgg * a) / 15) << 5 |
                      ((bb * (15 - a) + fb * a) / 15));
}

static unsigned text_width(const photon_font_t *f, const char *s) {
    unsigned w = 0;
    for (; *s; ++s) if (*s >= 32 && *s < 127) w += f->width[*s - 32];
    return w;
}

typedef enum { CENTER, LEFT, RIGHT } align_t;

static void band_text(const photon_font_t *f, align_t align, int x, unsigned y, const char *s, uint16_t color) {
    const int w = (int)text_width(f, s);
    if (align == CENTER) x = (320 - w) / 2;
    else if (align == RIGHT) x -= w;
    if (x < 4) x = 4;
    for (; *s; ++s) {
        if (*s < 32 || *s >= 127) continue;
        const unsigned g = (unsigned)(*s - 32), gw = f->width[g];
        const uint8_t *d = f->data + f->offset[g];
        for (unsigned gy = 0; gy < f->height; ++gy) {
            const int row = (int)(y + gy) - (int)band_y;
            if (row < 0 || row >= (int)band_h) continue;
            for (unsigned gx = 0; gx < gw; ++gx) {
                const unsigned i = gy * gw + gx, a = (i & 1u) ? (d[i >> 1] & 15u) : (d[i >> 1] >> 4);
                const int px = x + (int)gx;
                if (a && px >= 0 && px < 316) {
                    uint16_t *p = &buf[(unsigned)row * 320u + (unsigned)px];
                    *p = blend565(*p, color, a);
                }
            }
        }
        x += (int)gw;
    }
}

static void band_bar(void) {
    const unsigned x0 = PHOTON_BAR_X0 + 1, x1 = PHOTON_BAR_X1 - 1;
    const unsigned fill = (level_progress_1024(points) * (x1 - x0)) / 1024u;
    for (unsigned y = PHOTON_BAR_Y0 + 1; y < PHOTON_BAR_Y1; ++y) {
        const int row = (int)y - (int)band_y;
        if (row < 0 || row >= (int)band_h) continue;
        for (unsigned x = x0; x < x0 + fill; ++x) buf[(unsigned)row * 320u + x] = BAR_FILL;
    }
}

static void band_points(void) {
    char t[24];
    snprintf(t, sizeof t, "%d pts", points);
    band_text(&photon_font_small, LEFT, 68, 166, t, NAVY);
    snprintf(t, sizeof t, "Lv %d", level_of(points));
    band_text(&photon_font_small, RIGHT, 264, 166, t, NAVY);
    band_bar();
}

static void draw_info(const char *title, const char *detail) {  /* rows 124..201: just below the pup tiles */
    band_begin(124, 78);
    band_text(&photon_font_large, CENTER, 0, 123, title, NAVY);
    band_text(&photon_font_small, CENTER, 0, 148, detail, MUTED);
    band_points();
    band_end();
}

static void draw_stats(void) {  /* the MENU screen, over the pup area too */
    char v[40];
    band_begin(BUF_Y0, BUF_ROWS);
    band_text(&photon_font_large, CENTER, 0, 24, "stats", NAVY);
    const char *rows[4] = {"People met", "Matches caught", "Total points", "Level"};
    for (int i = 0; i < 4; ++i) {
        const unsigned y = 56u + (unsigned)i * 21u;
        band_text(&photon_font_small, LEFT, 56, y, rows[i], NAVY);
        if (i == 0) snprintf(v, sizeof v, "%d", met);
        else if (i == 1) snprintf(v, sizeof v, "%d", caught);
        else if (i == 2) snprintf(v, sizeof v, "%d", points);
        else snprintf(v, sizeof v, "Lv %d  %s", level_of(points), LEVEL_NAME[level_of(points) - 1]);
        band_text(&photon_font_small, RIGHT, 264, y, v, MUTED);
    }
    band_text(&photon_font_small, CENTER, 0, 146, "press BACK to close", MUTED);
    band_points();
    band_end();
}

/* ---- map mode: the mutuals website talks to the badge over USB (Web Serial) ----
 * website → badge, about once a second:  "M <s> <nearby> <meters> <points> <met> <name>\n"
 *   s = H not discoverable · A sharing, nobody near · N someone near · C someone right here
 * badge → website:  "B gray|yellow|green|blue|red", "P <points> <caught>" when practice earns points,
 *                   "HI mutuals-badge 2" when asked with "?". */
static struct { bool on; char state; int nearby, meters, gained; char name[28]; uint32_t last; } map;
static char rx[112];
static unsigned rx_n;

static void report_points(void) { printf("P %d %d\n", points, caught); }

static void map_parse(const char *s, uint32_t now) {
    if (s[0] == '?') { printf("HI mutuals-badge 2\n"); report_points(); return; }
    if (s[0] != 'M' || s[1] != ' ') return;
    char st = 0;
    int nearby = 0, meters = 0, web_points = 0, web_met = 0, used = 0;
    if (sscanf(s + 2, "%c %d %d %d %d %n", &st, &nearby, &meters, &web_points, &web_met, &used) < 5 ||
        !strchr("HANC", st))
        return;
    map.state = st, map.nearby = nearby, map.meters = meters, map.last = now, map.on = true;
    strncpy(map.name, used ? s + 2 + used : "", sizeof map.name - 1);
    map.name[sizeof map.name - 1] = 0;
    met = web_met;
    if (web_points > points) { map.gained = web_points - points; points = web_points; }
    else if (web_points < points) report_points();  /* practice points the website hasn't seen yet */
}

static void map_poll(uint32_t now) {
    int c;
    while ((c = getchar_timeout_us(0)) != PICO_ERROR_TIMEOUT) {
        if (c == '\n') { rx[rx_n] = 0; map_parse(rx, now); rx_n = 0; }
        else if (c >= 32 && c < 127 && rx_n < sizeof rx - 1) rx[rx_n++] = (char)c;
    }
    if (map.on && now - map.last > MAP_TIMEOUT_MS) map.on = false;
}

/* ---- views ---- */
typedef enum {
    V_HOME, V_LONELY, V_PROMPT, V_MUTUAL, V_MISS,   /* practice */
    V_HIDDEN, V_LOOKING, V_NEARBY, V_FOUND,          /* map mode */
    V_LEVELUP, V_STATS, V_NONE
} view_t;

static photon_sprite_id_t view_sprite(view_t v) {
    switch (v) {
        case V_HOME: case V_LEVELUP: return (photon_sprite_id_t)(SP_LV1 + level_of(points) - 1);
        case V_LONELY: case V_LOOKING: return SP_LOOKING;
        case V_PROMPT: return SP_MATCH;
        case V_MUTUAL: case V_FOUND: return SP_MUTUAL;
        case V_MISS: return SP_MISS;
        case V_NEARBY: return SP_NEARBY;
        case V_HIDDEN: return SP_OFFLINE;
        default: return SP_BLANK;
    }
}

static void view_text(view_t v, char *title, char *detail, size_t n) {
    const char *who = map.name[0] ? map.name : "someone";
    detail[0] = 0;
    switch (v) {
        case V_HOME:
            snprintf(title, n, "ready to meet?");
            snprintf(detail, n, misses >= IDLE_MISSES ? "press NEXT for a match" : "catch matches with YES");
            break;
        case V_LONELY: snprintf(title, n, "looking..."); snprintf(detail, n, "your pup misses people"); break;
        case V_PROMPT: snprintf(title, n, "match found!"); snprintf(detail, n, "press YES before it's gone!"); break;
        case V_MUTUAL: snprintf(title, n, "it's mutual!"); snprintf(detail, n, "+%d pts", PTS_CATCH); break;
        case V_MISS: snprintf(title, n, "too slow..."); snprintf(detail, n, "next one will come!"); break;
        case V_HIDDEN: snprintf(title, n, "not discoverable"); snprintf(detail, n, "press YES to share your spot"); break;
        case V_LOOKING: snprintf(title, n, "looking..."); snprintf(detail, n, "you're on the map"); break;
        case V_NEARBY:
            snprintf(title, n, "someone's nearby!");
            if (map.nearby > 1) snprintf(detail, n, "%s - %d m  +%d more", who, map.meters, map.nearby - 1);
            else snprintf(detail, n, "%s - %d m", who, map.meters);
            break;
        case V_FOUND:
            snprintf(title, n, "you found them!");
            if (map.gained > 0) snprintf(detail, n, "+%d pts  %s", map.gained, who);
            else snprintf(detail, n, "%s - %d m", who, map.meters);
            break;
        case V_LEVELUP:
            snprintf(title, n, "level up!");
            snprintf(detail, n, "Lv %d  %s", level_of(points), LEVEL_NAME[level_of(points) - 1]);
            break;
        default: title[0] = 0; break;
    }
}

static view_t map_view(void) {
    switch (map.state) {
        case 'A': return V_LOOKING;
        case 'N': return V_NEARBY;
        case 'C': return V_FOUND;
        default: return V_HIDDEN;
    }
}

static uint32_t last_near_sound;
static bool near_sounded;

static void on_enter(view_t from, view_t to, uint32_t now) {  /* sound + lights for a new base view */
    switch (to) {
        /* practice prompts and misses are silent: they happen on their own, and an idle badge must stay quiet */
        case V_PROMPT: led_all(255, 190, 20); break;
        case V_MUTUAL: play(snd_yes, snd_yes_len); break;  /* you pressed YES */
        case V_MISS: led_all(60, 0, 0); break;
        case V_NEARBY:
            if (from != V_FOUND && (!near_sounded || now - last_near_sound > NEAR_SOUND_GAP_MS)) {
                play(snd_near, snd_near_len);
                last_near_sound = now, near_sounded = true;
            }
            led_all(255, 150, 20);
            break;
        case V_FOUND: play(snd_close, snd_close_len); break;
        case V_HIDDEN:
            if (from == V_LOOKING || from == V_NEARBY || from == V_FOUND) play(snd_hide, snd_hide_len);
            led_all(12, 8, 24);
            break;
        case V_LOOKING: if (from == V_HIDDEN || from < V_HIDDEN) play(snd_yip, snd_yip_len); led_progress(); break;
        default: led_progress(); break;
    }
}

int main(void) {
    board_init();
    st7789_init_begin();  /* panel bring-up, same sequence as the BSP's ogvegas */
    absolute_time_t lcd_deadline = make_timeout_time_ms(2000);
    while (!st7789_ready() && !time_reached(lcd_deadline)) {
        st7789_init_step();
        sleep_ms(1);
    }
    leds_ok = ws2812_init(pio0, 0u);
    draw_background();   /* first picture before the backlight comes on */
    board_backlight(255);
#ifndef PHOTON_NO_SOUND
    audio_ok = i2s_audio_init(pio0, 2u);  /* after the screen is up: pio0 sm2, beside the LEDs on sm0 */
    if (audio_ok) i2s_audio_set_volume(8);
#endif

    uint32_t now = to_ms_since_boot(get_absolute_time());
    uint32_t rng = 0x1234567u ^ (now * 2654435761u);
#define RND() (rng ^= rng << 13, rng ^= rng >> 17, rng ^= rng << 5, rng)
#define NEXT_GAP() ((social == 0 ? 2500u : 4000u) + RND() % 5000u)

    int social = 2;
    view_t game = V_HOME;  /* practice state */
    uint32_t entered = now, next_prompt = now + 4000u, social_fade = now + SOCIAL_FADE_MS;
    view_t overlay = V_NONE, base_prev = V_NONE, shown = V_NONE;
    uint32_t overlay_until = 0, next_frame = now;
    unsigned frame = 0;
    char title[48], detail[48], drawn_title[48] = "", drawn_detail[48] = "";
    int drawn_points = -1;
    led_progress();
    play(snd_yip, snd_yip_len);  /* hi! */

    while (true) {
        now = to_ms_since_boot(get_absolute_time());
        const fwog_power_t power = fwog_power_poll(now);  /* buttons + the 6 s red power-off hold */
        const uint8_t pressed = power.buttons.pressed;
        if (audio_ok) i2s_audio_process();
        const int points_before = points;
        const bool was_map = map.on;
        map_poll(now);
        if (was_map && !map.on) game = V_HOME, entered = now, next_prompt = now + NEXT_GAP();

        /* ---- buttons ---- */
        if (pressed) misses = 0;  /* someone's here: practice can resume */
        const bool menu = pressed & FWOG_BTN_BIT(FWOG_BTN_GRAY);
        if (menu && overlay != V_STATS) {
            overlay = V_STATS, overlay_until = now + STATS_MS;
        } else if (overlay == V_STATS && (menu || (pressed & FWOG_BTN_BIT(FWOG_BTN_YELLOW)))) {
            overlay = V_NONE;
        } else if (map.on) {
            static const char *const names[5] = {"gray", "yellow", "green", "blue", "red"};
            for (unsigned b = 1; b < 5; ++b)
                if (pressed & FWOG_BTN_BIT(b)) printf("B %s\n", names[b]);
        } else if (overlay != V_STATS) {
            if (game == V_PROMPT && (pressed & FWOG_BTN_BIT(FWOG_BTN_GREEN))) {
                points += PTS_CATCH, caught++;
                if (social < MAX_SOCIAL) social++;
                game = V_MUTUAL, entered = now;
                report_points();
            } else if (game == V_PROMPT && (pressed & FWOG_BTN_BIT(FWOG_BTN_RED))) {
                game = V_MISS, entered = now;  /* a skip, not a miss: doesn't count toward pausing */
            } else if ((game == V_HOME || game == V_LONELY) && (pressed & FWOG_BTN_BIT(FWOG_BTN_GREEN))) {
                play(snd_yip, snd_yip_len);  /* say hi */
            } else if ((game == V_HOME || game == V_LONELY) && (pressed & FWOG_BTN_BIT(FWOG_BTN_BLUE))) {
                next_prompt = now;  /* NEXT: call the next match now */
            }
        }

        /* ---- practice timing (paused while stats are open or the website drives the badge) ---- */
        if (!map.on && overlay != V_STATS) {
            if ((int32_t)(now - social_fade) >= 0) { social_fade = now + SOCIAL_FADE_MS; if (social > 0) social--; }
            const uint32_t age = now - entered;
            if ((game == V_HOME || game == V_LONELY) && misses < IDLE_MISSES && (int32_t)(now - next_prompt) >= 0)
                game = V_PROMPT, entered = now;
            else if (game == V_PROMPT && age > PROMPT_MS) game = V_MISS, entered = now, misses++;
            else if ((game == V_MUTUAL || game == V_MISS) && age > RESULT_MS) {
                game = V_HOME, entered = now, next_prompt = now + NEXT_GAP();
            }
            if (game == V_HOME && social == 0) game = V_LONELY;
            if (game == V_LONELY && social > 0) game = V_HOME;
        } else if (overlay == V_STATS) {
            next_prompt = now + 3000u;
        }

        /* ---- overlays ---- */
        if (overlay != V_NONE && (int32_t)(now - overlay_until) >= 0) overlay = V_NONE;
        const view_t base = map.on ? map_view() : game;
        const bool leveled = level_of(points) > level_of(points_before);
        if (base != base_prev) {
            if (!leveled && !power.armed) on_enter(base_prev, base, now);
            if (base != V_FOUND) map.gained = 0;
            base_prev = base;
        }
        if (leveled) {
            overlay = V_LEVELUP, overlay_until = now + LEVELUP_MS;
            play(snd_levelup, snd_levelup_len);
        }
        const view_t view = overlay != V_NONE ? overlay : base;

        /* ---- picture ---- */
        if (view != shown) {
            if (shown == V_STATS || shown == V_NONE || view == V_STATS) draw_background();
            if (view == V_STATS) {
                draw_stats();
                drawn_points = points;
            } else {
                draw_sprite(view_sprite(view), 0);
                drawn_title[0] = 0, drawn_points = -1;  /* force the text below */
            }
            shown = view;
            next_frame = now + FRAME_MS;
            if (view == V_HOME || view == V_LONELY || view == V_LOOKING) led_progress();
        }
        if (view == V_STATS) {
            if (points != drawn_points) { draw_stats(); drawn_points = points; }
        } else {
            view_text(view, title, detail, sizeof title);
            if (strcmp(title, drawn_title) || strcmp(detail, drawn_detail) || points != drawn_points) {
                draw_info(title, detail);
                strcpy(drawn_title, title), strcpy(drawn_detail, detail), drawn_points = points;
            }
            if ((int32_t)(now - next_frame) >= 0) {
                const bool party = view == V_MUTUAL || view == V_FOUND || view == V_LEVELUP;
                next_frame = now + (party ? 160u : FRAME_MS);
                frame++;
                draw_sprite(view_sprite(view), frame);
                if (party && !power.armed) led_rainbow(frame);
            }
        }
        sleep_ms(2);
    }
}
