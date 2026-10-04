/*
 * Photon Pup, native on the FREE-WILi OG display CPU: the pixel-art networking Tamagotchi on the badge's own LCD.
 *
 *   The pup wanders (bobbing). Match prompts pop up at random: press GREEN in time → DOUBLE YES (+1 social,
 *   score +1, rainbow LEDs). Too slow or RED → "too slow". YELLOW = coffee (+1 energy), BLUE = nap (energy
 *   refills), GREEN while wandering = say hi (joy, no points). Social fades over time (lonely pup); at 0 energy
 *   it naps until BLUE. LEDs are the meters: 4 pink = social, 3 green = energy. Score is drawn top-right.
 *
 * Built with the FREE-WILi wiliOGbsp (see native/build.sh). Same game rules as freewili/pet_game.py.
 * Holding RED for 6 s still powers the board off (FWOG_POWER_DEFAULT), so RED presses here are short taps.
 */
#include "fwog_display.h"
#include "hardware/pio.h"
#include "pico/stdlib.h"
#include "photon_assets.h"
#include "photon_sounds.h"

FWOG_POWER_DEFAULT();

#define MAX_SOCIAL 4
#define MAX_ENERGY 3
#define PROMPT_MS 1600u
#define SOCIAL_FADE_MS 25000u
#define ENERGY_FADE_MS 40000u
#define FRAME_MS 330u

typedef enum { WANDER, PROMPT, YES, MISS, COFFEE, NAP } mode_t;

static int social = 2, energy = MAX_ENERGY, score = 0;
static bool leds_ok, audio_ok;
static uint32_t rng = 0x1234567u;

static uint32_t rnd(void) {  /* xorshift: just enough randomness for prompt timing */
    rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5;
    return rng;
}

static uint32_t next_gap(void) { return (social == 0 ? 2500u : 4000u) + rnd() % 5000u; }

/* ---- LEDs ---- */
static void led_all(uint8_t r, uint8_t g, uint8_t b) {
    if (!leds_ok) return;
    for (unsigned i = 0; i < FWOG_LED_COUNT; ++i) ws2812_set_color(i, r, g, b);
    ws2812_process();
}

static void led_meters(void) {
    if (!leds_ok) return;
    for (int i = 0; i < MAX_SOCIAL; ++i)
        ws2812_set_color((unsigned)i, i < social ? 255 : 10, i < social ? 60 : 6, i < social ? 110 : 8);
    for (int i = 0; i < MAX_ENERGY; ++i)
        ws2812_set_color((unsigned)(MAX_SOCIAL + i), i < energy ? 30 : 4, i < energy ? 200 : 8, i < energy ? 90 : 6);
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

/* ---- sound: synthesized chiptune clips (native/make_sounds.py), same driver pattern as the BSP's ogvegas ---- */
static void play(const int16_t *clip, unsigned n) {
    if (!audio_ok) return;
    if (!i2s_audio_is_idle()) i2s_audio_stop();  /* a new event cuts off the old sound */
    i2s_audio_start(clip, n, true, false);
}

/* ---- screen ---- */
static void draw_full(photon_scene_id_t s) {
    st7789_set_window(0, 0, 320, 240);
    st7789_blit(photon_scenes[s].full, 320u * 240u);
}

static void draw_tile(photon_scene_id_t s, unsigned i) {
    const photon_scene_t *sc = &photon_scenes[s];
    if (sc->tile_count == 0) return;
    st7789_set_window(PHOTON_TILE_X, PHOTON_TILE_Y, PHOTON_TILE_W, PHOTON_TILE_H);
    st7789_blit(sc->tiles[i % sc->tile_count], PHOTON_TILE_W * PHOTON_TILE_H);
}

/* 3x5 pixel digits for the score, drawn with fill_rect blocks */
static const uint16_t DIGITS[10] = {0x7B6F, 0x2C97, 0x73E7, 0x73CF, 0x5BC9, 0x79CF, 0x79EF, 0x7249, 0x7BEF, 0x7BCF};

static void draw_score(void) {
    const uint16_t navy = 0x2149, bg = 0xCF7C;  /* RGB565 */
    const uint16_t s = 4, x0 = 320 - 8 - 3 * (4 * s), y0 = 6;
    st7789_fill_rect(x0 - 2, y0 - 2, 3 * 4 * s + 4, 5 * s + 4, bg);
    int v = score > 999 ? 999 : score;
    int d[3] = {v / 100, (v / 10) % 10, v % 10};
    for (int k = 0; k < 3; ++k) {
        if (k < 2 && d[0] == 0 && (k == 0 || d[1] == 0)) continue;  /* no leading zeros */
        for (int row = 0; row < 5; ++row)
            for (int col = 0; col < 3; ++col)
                if (DIGITS[d[k]] >> (14 - (row * 3 + col)) & 1)
                    st7789_fill_rect(x0 + k * 4 * s + col * s, y0 + row * s, s, s, navy);
    }
}

static photon_scene_id_t scene_for(mode_t m) {
    switch (m) {
        case WANDER: return social == 0 ? SC_LONELY : SC_IDLE;
        case PROMPT: return SC_MATCH;
        case YES: return SC_YES;
        case MISS: return SC_MISS;
        case COFFEE: return SC_COFFEE;
        default: return SC_NAP;
    }
}

int main(void) {
    board_init();
    st7789_init_begin();  /* start the panel bring-up (same sequence as the BSP's ogvegas) */
    absolute_time_t lcd_deadline = make_timeout_time_ms(2000);
    while (!st7789_ready() && !time_reached(lcd_deadline)) {
        st7789_init_step();
        sleep_ms(1);
    }
    leds_ok = ws2812_init(pio0, 0u);
    draw_full(SC_IDLE);   /* first picture before the backlight comes on: no flash of garbage */
    board_backlight(255);
#ifndef PHOTON_NO_SOUND
    audio_ok = i2s_audio_init(pio0, 2u);  /* after the screen is up: pio0 sm2, beside the LEDs on sm0 (as ogvegas) */
    if (audio_ok) i2s_audio_set_volume(8);
#endif

    uint32_t now = to_ms_since_boot(get_absolute_time());
    rng ^= now * 2654435761u;
    mode_t mode = WANDER;
    uint32_t entered = now, next_prompt = now + next_gap();
    uint32_t social_fade = now + SOCIAL_FADE_MS, energy_fade = now + ENERGY_FADE_MS, next_frame = now;
    photon_scene_id_t shown = PHOTON_SCENE_COUNT;
    unsigned frame = 0;
    led_meters();
    play(snd_yip, snd_yip_len);  /* hello! */

    while (true) {
        now = to_ms_since_boot(get_absolute_time());
        const fwog_power_t power = fwog_power_poll(now);  /* buttons + the 6 s red power-off hold */
        const uint8_t pressed = power.buttons.pressed;
        if (audio_ok) i2s_audio_process();
        const mode_t before = mode;

        /* ---- buttons ---- */
        if (mode == PROMPT && (pressed & FWOG_BTN_BIT(FWOG_BTN_GREEN))) {
            if (social < MAX_SOCIAL) social++;
            score++;
            mode = YES, entered = now;
        } else if (mode == PROMPT && (pressed & FWOG_BTN_BIT(FWOG_BTN_RED))) {
            mode = MISS, entered = now;
        } else if (mode == WANDER && (pressed & FWOG_BTN_BIT(FWOG_BTN_YELLOW))) {
            if (energy < MAX_ENERGY) energy++;
            mode = COFFEE, entered = now;
        } else if ((mode == WANDER || mode == NAP) && (pressed & FWOG_BTN_BIT(FWOG_BTN_BLUE))) {
            energy = MAX_ENERGY;
            mode = NAP, entered = now;
        } else if (mode == WANDER && (pressed & FWOG_BTN_BIT(FWOG_BTN_GREEN))) {
            mode = YES, entered = now - 800u;  /* say hi: a short happy bounce, no points */
            play(snd_yip, snd_yip_len);
        }

        /* ---- time ---- */
        if ((int32_t)(now - social_fade) >= 0) { social_fade = now + SOCIAL_FADE_MS; if (social > 0) social--; }
        if ((int32_t)(now - energy_fade) >= 0) { energy_fade = now + ENERGY_FADE_MS; if (energy > 0) energy--; }
        const uint32_t age = now - entered;
        if (mode == WANDER && energy == 0) mode = NAP, entered = now;
        else if (mode == WANDER && (int32_t)(now - next_prompt) >= 0) mode = PROMPT, entered = now;
        else if (mode == PROMPT && age > PROMPT_MS) mode = MISS, entered = now;
        else if (((mode == YES || mode == COFFEE || mode == MISS) && age > 1600u) ||
                 (mode == NAP && energy > 0 && age > 3000u)) {
            mode = WANDER, entered = now, next_prompt = now + next_gap();
        }

        /* ---- lights + sound on mode change ---- */
        if (mode != before && !power.armed) {
            if (mode == PROMPT) play(snd_match, snd_match_len);
            else if (mode == YES && before == PROMPT) play(snd_yes, snd_yes_len);  /* a caught match ("hi" yips instead) */
            else if (mode == MISS) play(snd_miss, snd_miss_len);
            else if (mode == COFFEE) play(snd_coffee, snd_coffee_len);
            else if (mode == NAP) play(snd_nap, snd_nap_len);
            if (mode == PROMPT) led_all(255, 190, 20);
            else if (mode == COFFEE) led_all(255, 150, 20);
            else if (mode == NAP) led_all(40, 30, 90);
            else if (mode == MISS) led_all(60, 0, 0);
            else if (mode == WANDER) led_meters();
        }

        /* ---- picture ---- */
        const photon_scene_id_t sc = scene_for(mode);
        if (sc != shown) {
            draw_full(sc);
            shown = sc;
            if (sc == SC_IDLE || sc == SC_LONELY) draw_score();
            next_frame = now + FRAME_MS;
        } else if ((int32_t)(now - next_frame) >= 0) {
            next_frame = now + (mode == YES ? 160u : FRAME_MS);
            frame++;
            draw_tile(sc, frame);
            if (mode == YES && !power.armed) led_rainbow(frame);
            if (mode == WANDER && (frame % 6) == 0 && !power.armed) led_meters();  /* meters may have faded */
        }
        sleep_ms(2);
    }
}
