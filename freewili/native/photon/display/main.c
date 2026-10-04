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
 *   RADIO: badges also find each other directly, with no website or GPS needed (the OG has no Bluetooth, so this uses the
 *   main CPU's CC1101 sub-GHz radios; see ../main/main.c). Another badge heard → "someone's nearby!" with its
 *   wearer's name and signal; a strong signal → "you found them!". +10 / +50 pts the first time per badge.
 *   Not discoverable (NO on the map) = this badge stops broadcasting.
 *
 *   STYLE: the website's Cute / Formal switch ("T C" / "T F") picks the look. Cute is the pastel pixel pup with
 *   puppy noises (clubs, university mixers). Formal is white/navy line icons, professional wording, tiers and
 *   soft chimes (recruiting events).
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
#include "mutuals_link.h"

FWOG_POWER_DEFAULT();

#define RGB565(r, g, b) ((uint16_t)((((r) & 0xF8) << 8) | (((g) & 0xFC) << 3) | ((b) >> 3)))
#define NAVY RGB565(36, 40, 74)
#define MUTED RGB565(110, 108, 140)
#define BAR_FILL RGB565(92, 184, 138)
#define F_NAVY RGB565(22, 34, 64)
#define F_MUTED RGB565(90, 100, 125)
#define F_BAR RGB565(44, 98, 180)

/* Cute (clubs, university mixers) or formal (recruiting events), set by the website. */
static bool formal;
#define STYLE(cute, formal_text) (formal ? (formal_text) : (cute))
#define INK STYLE(NAVY, F_NAVY)
#define INK_SOFT STYLE(MUTED, F_MUTED)

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
#define NEAR_SOUND_GAP_MS 45000u
#define RADIO_CLOSE_DBM (-50)    /* stronger than this = "you found them!" (badges within a couple of metres) */
#define RADIO_STALE_MS 1500u     /* main reports every 0.5 s; older than this = nobody heard */
#define PTS_NEARBY 10
#define PTS_FOUND 50 /* GPS drift can flicker someone in and out of range: chime at most this often */

/* ---- points & levels (same table as the website: map/src/points.ts) ---- */
static const int LEVEL_AT[5] = {0, 50, 100, 200, 400};
static const char *const LEVEL_NAME_CUTE[5] = {"New here!", "Getting out there!", "Making connections!",
                                               "People magnet!", "Legend!"};
static const char *const LEVEL_NAME_FORMAL[5] = {"Newcomer", "Networker", "Connector", "Influencer", "Ambassador"};
#define LEVEL_NAME STYLE(LEVEL_NAME_CUTE, LEVEL_NAME_FORMAL)
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

typedef enum { SFX_HI, SFX_MUTUAL, SFX_NEAR, SFX_FOUND, SFX_HIDE, SFX_LEVEL } sfx_t;

static void sfx(sfx_t e) {  /* the same moments, puppy-flavoured or chime-flavoured */
    switch (e) {
        case SFX_HI: formal ? play(snd_f_tick, snd_f_tick_len) : play(snd_yip, snd_yip_len); break;
        case SFX_MUTUAL: formal ? play(snd_f_connect, snd_f_connect_len) : play(snd_yes, snd_yes_len); break;
        case SFX_NEAR: formal ? play(snd_f_chime, snd_f_chime_len) : play(snd_near, snd_near_len); break;
        case SFX_FOUND: formal ? play(snd_f_connect, snd_f_connect_len) : play(snd_close, snd_close_len); break;
        case SFX_HIDE: formal ? play(snd_f_soft, snd_f_soft_len) : sfx(SFX_HIDE); break;
        case SFX_LEVEL: formal ? play(snd_f_tier, snd_f_tier_len) : play(snd_levelup, snd_levelup_len); break;
    }
}

/* ---- screen ---- */
static void draw_background(void) {
    st7789_set_window(0, 0, 320, 240);
    st7789_blit(photon_backgrounds[formal], 320u * 240u);
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
    memcpy(buf, photon_backgrounds[formal] + y * 320u, 320u * h * sizeof buf[0]);
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
        for (unsigned x = x0; x < x0 + fill; ++x) buf[(unsigned)row * 320u + x] = STYLE(BAR_FILL, F_BAR);
    }
}

static void band_points(void) {
    char t[24];
    snprintf(t, sizeof t, "%d pts", points);
    band_text(&photon_font_small, LEFT, 68, 166, t, INK);
    snprintf(t, sizeof t, STYLE("Lv %d", "Tier %d"), level_of(points));
    band_text(&photon_font_small, RIGHT, 264, 166, t, INK);
    band_bar();
}

static void draw_info(const char *title, const char *detail) {  /* rows 124..201: just below the pup tiles */
    band_begin(124, 78);
    band_text(&photon_font_large, CENTER, 0, 123, title, INK);
    band_text(&photon_font_small, CENTER, 0, 148, detail, INK_SOFT);
    band_points();
    band_end();
}

static void draw_stats(void);  /* below: it shows the radio too */

/* Who this badge is on the radio: discoverable follows the map (not discoverable = radio silent). */
static bool link_ok, discoverable = true, me_dirty = true;
static char my_name[MUTUALS_NAME_MAX + 1];

/* ---- map mode: the mutuals website talks to the badge over USB (Web Serial) ----
 * website → badge, about once a second:  "M <s> <nearby> <meters> <points> <met> <name>\n"
 *   s = H not discoverable · A sharing, nobody near · N someone near · C someone right here
 *                   "N <my name>"  (the name this badge broadcasts to nearby badges while discoverable)
 *                   "T C" / "T F"  (style: cute / formal)
 * badge → website:  "B gray|yellow|green|blue|red", "P <points> <caught> <met>" when the badge earns points
 *                   (practice, radio finds), "R <count> <rssi> <name>" while other badges are heard,
 *                   "HI mutuals-badge 3" when asked with "?". */
static struct { bool on; char state; int nearby, meters, gained; char name[28]; uint32_t last; } map;
static char rx[112];
static unsigned rx_n;

static void report_points(void) { printf("P %d %d %d\n", points, caught, met); }

static void map_parse(const char *s, uint32_t now) {
    if (s[0] == '?') { printf("HI mutuals-badge 3\n"); report_points(); return; }
    if (s[0] == 'T' && s[1] == ' ') { formal = s[2] == 'F'; return; }  /* style: "T C" cute, "T F" formal */
    if (s[0] == 'N' && s[1] == ' ') {  /* "N <my name>": broadcast it to nearby badges while discoverable */
        char name[MUTUALS_NAME_MAX + 1] = "";
        strncpy(name, s + 2, MUTUALS_NAME_MAX);
        if (strcmp(name, my_name)) { strcpy(my_name, name); me_dirty = true; }
        return;
    }
    if (s[0] != 'M' || s[1] != ' ') return;
    char st = 0;
    int nearby = 0, meters = 0, web_points = 0, web_met = 0, used = 0;
    if (sscanf(s + 2, "%c %d %d %d %d %n", &st, &nearby, &meters, &web_points, &web_met, &used) < 5 ||
        !strchr("HANC", st))
        return;
    map.state = st, map.nearby = nearby, map.meters = meters, map.last = now, map.on = true;
    strncpy(map.name, used ? s + 2 + used : "", sizeof map.name - 1);
    map.name[sizeof map.name - 1] = 0;
    if (web_met > met) met = web_met;
    if (discoverable != (st != 'H')) { discoverable = st != 'H'; me_dirty = true; }
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

/* ---- radio: badges near this one, reported by the main CPU over the inter-CPU link ---- */
static struct { uint8_t count; int rssi; uint8_t id[4]; char name[MUTUALS_NAME_MAX + 1]; uint32_t last; bool ok; } radio;
static fwog_link_rx_t link_rx;
static uint8_t seen_near[16][4], seen_found[16][4];
static unsigned n_near, n_found;

static bool seen(uint8_t list[][4], unsigned *n, const uint8_t id[4]) {  /* true if new (and remembers it) */
    for (unsigned i = 0; i < *n; ++i) if (memcmp(list[i], id, 4) == 0) return false;
    memcpy(list[*n % 16], id, 4);
    if (*n < 16) (*n)++;
    return true;
}

static void link_poll(uint32_t now) {
    if (!link_ok) return;
    uint8_t b;
    size_t len;
    while (fwog_link_uart_read(&b)) {
        if (!fwog_link_rx_byte(&link_rx, b, &len)) continue;
        const uint8_t *p = link_rx.buf;
        if (len == sizeof(mutuals_msg_peers_t) && p[0] == MUTUALS_MSG_PEERS) {
            const mutuals_msg_peers_t *m = (const mutuals_msg_peers_t *)p;
            radio.count = m->count, radio.rssi = m->rssi, radio.ok = m->radio_ok, radio.last = now;
            memcpy(radio.id, m->id, 4);
            memcpy(radio.name, m->name, MUTUALS_NAME_MAX);
            radio.name[MUTUALS_NAME_MAX] = 0;
        } else {
            (void)fwog_ioexp_link_handle(p, len);  /* the BSP's own I/O-direction messages */
        }
    }
}

static void link_send_me(void) {
    if (!link_ok) return;
    mutuals_msg_me_t m;
    memset(&m, 0, sizeof m);
    m.type = MUTUALS_MSG_ME;
    m.discoverable = discoverable;
    memcpy(m.name, my_name, strnlen(my_name, MUTUALS_NAME_MAX));
    fwog_link_uart_send_frame(&m, sizeof m);
}

static void draw_stats(void) {  /* the MENU screen, over the pup area too */
    char v[40];
    band_begin(BUF_Y0, BUF_ROWS);
    band_text(&photon_font_large, CENTER, 0, 22, STYLE("stats", "Summary"), INK);
    const char *rows[5] = {"People met", STYLE("Matches caught", "Practice matches"), "Total points",
                           STYLE("Level", "Tier"), "Radio"};
    for (int i = 0; i < 5; ++i) {
        const unsigned y = 50u + (unsigned)i * 18u;
        band_text(&photon_font_small, LEFT, 56, y, rows[i], INK);
        if (i == 0) snprintf(v, sizeof v, "%d", met);
        else if (i == 1) snprintf(v, sizeof v, "%d", caught);
        else if (i == 2) snprintf(v, sizeof v, "%d", points);
        else if (i == 3) snprintf(v, sizeof v, STYLE("Lv %d  %s", "Tier %d  %s"), level_of(points), LEVEL_NAME[level_of(points) - 1]);
        else if (!link_ok || !radio.ok) snprintf(v, sizeof v, "off");
        else if (!discoverable) snprintf(v, sizeof v, "silent (hidden)");
        else snprintf(v, sizeof v, "on  %d badge%s near", radio.count, radio.count == 1 ? "" : "s");
        band_text(&photon_font_small, RIGHT, 264, y, v, INK_SOFT);
    }
    band_text(&photon_font_small, CENTER, 0, 144, "press BACK to close", INK_SOFT);
    band_points();
    band_end();
}

/* ---- views ---- */
typedef enum {
    V_HOME, V_LONELY, V_PROMPT, V_MUTUAL, V_MISS,   /* practice */
    V_HIDDEN, V_LOOKING, V_NEARBY, V_FOUND,          /* map mode */
    V_LEVELUP, V_STATS, V_NONE
} view_t;

static photon_sprite_id_t view_sprite(view_t v) {
    if (formal) switch (v) {
        case V_HOME: return SPF_HOME;
        case V_LEVELUP: return SPF_LEVEL;
        case V_LONELY: case V_LOOKING: return SPF_LOOKING;
        case V_PROMPT: return SPF_MATCH;
        case V_MUTUAL: case V_FOUND: return SPF_MUTUAL;
        case V_MISS: return SPF_MISS;
        case V_NEARBY: return SPF_NEARBY;
        case V_HIDDEN: return SPF_OFFLINE;
        default: return SP_BLANK;
    }
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

static bool radio_src;  /* the current NEARBY / FOUND view comes from the radio, not the map */

static void view_text(view_t v, char *title, char *detail, size_t n) {
    const char *who = radio_src ? (radio.name[0] ? radio.name : "a mutuals badge") : (map.name[0] ? map.name : "someone");
    detail[0] = 0;
    switch (v) {
        case V_HOME:
            snprintf(title, n, STYLE("ready to meet?", "Ready to connect"));
            snprintf(detail, n, misses >= IDLE_MISSES ? "press NEXT for a match" : STYLE("catch matches with YES", "practice with YES"));
            break;
        case V_LONELY: snprintf(title, n, STYLE("looking...", "Searching...")); snprintf(detail, n, STYLE("your pup misses people", "no recent connections")); break;
        case V_PROMPT: snprintf(title, n, STYLE("match found!", "Potential match")); snprintf(detail, n, STYLE("press YES before it's gone!", "press YES to connect")); break;
        case V_MUTUAL: snprintf(title, n, STYLE("it's mutual!", "Mutual interest")); snprintf(detail, n, "+%d pts", PTS_CATCH); break;
        case V_MISS: snprintf(title, n, STYLE("too slow...", "Missed")); snprintf(detail, n, STYLE("next one will come!", "another will come")); break;
        case V_HIDDEN: snprintf(title, n, STYLE("not discoverable", "Private mode")); snprintf(detail, n, STYLE("press YES to share your spot", "press YES to become visible")); break;
        case V_LOOKING: snprintf(title, n, STYLE("looking...", "Searching nearby")); snprintf(detail, n, STYLE("you're on the map", "you're visible on the map")); break;
        case V_NEARBY:
            snprintf(title, n, STYLE("someone's nearby!", "Contact nearby"));
            if (radio_src) snprintf(detail, n, "%s  signal %d dBm", who, radio.rssi);
            else if (map.nearby > 1) snprintf(detail, n, "%s - %d m  +%d more", who, map.meters, map.nearby - 1);
            else snprintf(detail, n, "%s - %d m", who, map.meters);
            break;
        case V_FOUND:
            snprintf(title, n, STYLE("you found them!", "Connection made"));
            if (map.gained > 0) snprintf(detail, n, "+%d pts  %s", map.gained, who);
            else if (radio_src) snprintf(detail, n, STYLE("%s  right here!", "%s  in person"), who);
            else snprintf(detail, n, "%s - %d m", who, map.meters);
            break;
        case V_LEVELUP:
            snprintf(title, n, STYLE("level up!", "Tier up"));
            snprintf(detail, n, STYLE("Lv %d  %s", "Tier %d  %s"), level_of(points), LEVEL_NAME[level_of(points) - 1]);
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
        case V_MUTUAL: sfx(SFX_MUTUAL); break;  /* you pressed YES */
        case V_MISS: led_all(60, 0, 0); break;
        case V_NEARBY:
            if (from != V_FOUND && (!near_sounded || now - last_near_sound > NEAR_SOUND_GAP_MS)) {
                sfx(SFX_NEAR);
                last_near_sound = now, near_sounded = true;
            }
            led_all(255, 150, 20);
            break;
        case V_FOUND: sfx(SFX_FOUND); break;
        case V_HIDDEN:
            if (from == V_LOOKING || from == V_NEARBY || from == V_FOUND) sfx(SFX_HIDE);
            led_all(12, 8, 24);
            break;
        case V_LOOKING: if (from == V_HIDDEN || from < V_HIDDEN) sfx(SFX_HI); led_progress(); break;
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
    link_ok = fwog_link_uart_init(FWOG_LINK_BAUD);  /* radio reports from the main CPU */
    fwog_link_rx_init(&link_rx);
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
    uint32_t next_me = now, next_radio_line = now;
    led_progress();
    sfx(SFX_HI);  /* hi! */

    while (true) {
        now = to_ms_since_boot(get_absolute_time());
        const fwog_power_t power = fwog_power_poll(now);  /* buttons + the 6 s red power-off hold */
        const uint8_t pressed = power.buttons.pressed;
        if (audio_ok) i2s_audio_process();
        const int points_before = points;
        const bool was_map = map.on, was_formal = formal;
        map_poll(now);
        link_poll(now);
        if (formal != was_formal) shown = V_NONE;  /* restyle: redraw everything */
        if (me_dirty || (int32_t)(now - next_me) >= 0) { link_send_me(); me_dirty = false; next_me = now + 2000u; }
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
                sfx(SFX_HI);  /* say hi */
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
        view_t base = map.on ? map_view() : game;
        radio_src = false;
        const bool radio_near = discoverable && radio.count > 0 && now - radio.last < RADIO_STALE_MS;
        if (radio_near && (base == V_HOME || base == V_LONELY || base == V_LOOKING || base == V_NEARBY)) {
            base = radio.rssi >= RADIO_CLOSE_DBM ? V_FOUND : V_NEARBY;
            radio_src = true;
        }
        if (radio_near) {  /* points the first time each badge is near / found, and tell the website */
            int gain = 0;
            if (seen(seen_near, &n_near, radio.id)) gain += PTS_NEARBY;
            if (radio.rssi >= RADIO_CLOSE_DBM && seen(seen_found, &n_found, radio.id)) gain += PTS_FOUND, met++;
            if (gain) { points += gain; map.gained = gain; report_points(); }
            if (map.on && (int32_t)(now - next_radio_line) >= 0) {
                printf("R %d %d %s\n", radio.count, radio.rssi, radio.name);
                next_radio_line = now + 1000u;
            }
        }
        const bool leveled = level_of(points) > level_of(points_before);
        if (base != base_prev) {
            if (!leveled && !power.armed) on_enter(base_prev, base, now);
            if (base != V_FOUND && !(radio_src && base == V_NEARBY)) map.gained = 0;
            base_prev = base;
        }
        if (leveled) {
            overlay = V_LEVELUP, overlay_until = now + LEVELUP_MS;
            sfx(SFX_LEVEL);
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
            static int drawn_radio = -1;
            const int radio_now = (radio.ok ? 100 : 0) + (discoverable ? 50 : 0) + radio.count;
            if (points != drawn_points || radio_now != drawn_radio) {
                draw_stats();
                drawn_points = points, drawn_radio = radio_now;
            }
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
