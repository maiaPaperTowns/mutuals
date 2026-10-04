#ifndef PHOTON_SOUNDS_H
#define PHOTON_SOUNDS_H
#include <stdint.h>
/* Synthesized character sounds (native/make_sounds.py): 8 kHz mono int16. */
extern const int16_t snd_yip[], snd_match[], snd_yes[], snd_miss[], snd_near[], snd_close[], snd_hide[], snd_levelup[],
    snd_f_chime[], snd_f_connect[], snd_f_soft[], snd_f_tier[], snd_f_tick[];
extern const unsigned snd_yip_len, snd_match_len, snd_yes_len, snd_miss_len, snd_near_len, snd_close_len, snd_hide_len,
    snd_levelup_len, snd_f_chime_len, snd_f_connect_len, snd_f_soft_len, snd_f_tier_len, snd_f_tick_len;
#endif
