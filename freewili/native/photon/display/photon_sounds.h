#ifndef PHOTON_SOUNDS_H
#define PHOTON_SOUNDS_H
#include <stdint.h>
/* Synthesized character sounds (native/make_sounds.py): 8 kHz mono int16. */
extern const int16_t snd_yip[], snd_match[], snd_yes[], snd_miss[], snd_near[], snd_close[], snd_hide[], snd_levelup[];
extern const unsigned snd_yip_len, snd_match_len, snd_yes_len, snd_miss_len, snd_near_len, snd_close_len, snd_hide_len,
    snd_levelup_len;
#endif
