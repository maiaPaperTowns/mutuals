#ifndef PHOTON_ASSETS_H
#define PHOTON_ASSETS_H
#include <stdint.h>

/* Order matches native/make_assets.py SCENES. */
typedef enum { SC_IDLE, SC_LONELY, SC_MATCH, SC_YES, SC_MISS, SC_COFFEE, SC_NAP, PHOTON_SCENE_COUNT } photon_scene_id_t;

typedef struct {
    const uint16_t *full;           /* 320x240 RGB565 */
    const uint16_t *const *tiles;   /* puppy area at other bob offsets */
    unsigned tile_count;
} photon_scene_t;

#define PHOTON_TILE_X 60
#define PHOTON_TILE_Y 24
#define PHOTON_TILE_W 200
#define PHOTON_TILE_H 128

extern const photon_scene_t photon_scenes[PHOTON_SCENE_COUNT];
#endif
