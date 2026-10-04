#ifndef PHOTON_ASSETS_H
#define PHOTON_ASSETS_H
#include <stdint.h>

/* mutuals screens (native/make_assets.py): one shared 320x240 background + pup sprites placed on it. */
#define PHOTON_TILE_X 84
#define PHOTON_TILE_Y 20
#define PHOTON_TILE_W 152
#define PHOTON_TILE_H 104

/* Order matches SPRITE_SET in native/make_assets.py. */
typedef enum {
    SP_LV1, SP_LV2, SP_LV3, SP_LV4, SP_LV5,   /* home: your pup grows up with your level */
    SP_LOOKING, SP_MATCH, SP_MUTUAL, SP_MISS, SP_NEARBY, SP_OFFLINE, SP_BLANK,
    PHOTON_SPRITE_COUNT
} photon_sprite_id_t;

typedef struct {
    const uint16_t *const *tiles;   /* PHOTON_TILE_W x PHOTON_TILE_H, one per bob offset */
    unsigned tile_count;
} photon_sprite_t;

extern const uint16_t photon_background_px[320 * 240];
extern const photon_sprite_t photon_sprites[PHOTON_SPRITE_COUNT];

/* Where the badge draws live values (must match make_assets.py). */
#define PHOTON_BAR_X0 56
#define PHOTON_BAR_Y0 186
#define PHOTON_BAR_X1 264
#define PHOTON_BAR_Y1 193

/* ASCII 32..126, 4-bit alpha (high nibble = left pixel), each glyph width x height, rows packed. */
typedef struct {
    const uint8_t *data;
    const uint32_t *offset;
    const uint8_t *width;
    unsigned height;
} photon_font_t;
extern const photon_font_t photon_font_small, photon_font_large;
#endif
