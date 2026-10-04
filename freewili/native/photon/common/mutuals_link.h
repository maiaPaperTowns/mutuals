/* mutuals: messages between the two CPUs (inter-CPU link, link_frame-encoded) and the radio beacon.
 *
 * Badge ↔ badge proximity runs on the main CPU's CC1101 radios (the OG has no Bluetooth): each badge broadcasts a
 * small beacon about every 0.7 s and listens for others; signal strength (RSSI) says how close they are.
 * The display CPU owns the screen, so it tells main who you are and whether to broadcast, and main reports the
 * badges it hears. Types start at 0x40: 0x01-0x1F are the bootloader's, 0x20-0x22 the BSP's I/O messages. */
#ifndef MUTUALS_LINK_H
#define MUTUALS_LINK_H
#include <stdint.h>

#define MUTUALS_RADIO_HZ 433920000u   /* inside the 387-464 MHz band the badge's default antenna path serves */
#define MUTUALS_RADIO_DBM 0
#define MUTUALS_NAME_MAX 12

/* Radio beacon payload. No name unless the wearer is sharing on the map; nothing at all when not discoverable. */
#define MUTUALS_BEACON_MAGIC0 'M'
#define MUTUALS_BEACON_MAGIC1 'U'
#define MUTUALS_BEACON_VERSION 1u
typedef struct __attribute__((packed)) {
    uint8_t magic[2];
    uint8_t version;
    uint8_t id[4];                    /* random per boot: not a persistent device id */
    uint8_t name_len;
    char name[MUTUALS_NAME_MAX];
} mutuals_beacon_t;

/* display → main: who I am, and whether to broadcast. Sent on change and every 2 s. */
#define MUTUALS_MSG_ME 0x40u
typedef struct __attribute__((packed)) {
    uint8_t type;                     /* MUTUALS_MSG_ME */
    uint8_t discoverable;             /* 0: radio silent (not discoverable on the map) */
    char name[MUTUALS_NAME_MAX];      /* NUL-padded; empty = anonymous */
} mutuals_msg_me_t;

/* main → display: the strongest badge heard in the last few seconds. Sent every 0.5 s. */
#define MUTUALS_MSG_PEERS 0x41u
typedef struct __attribute__((packed)) {
    uint8_t type;                     /* MUTUALS_MSG_PEERS */
    uint8_t count;                    /* badges heard recently (0: nobody) */
    int8_t rssi;                      /* dBm of the strongest, smoothed */
    uint8_t id[4];                    /* the strongest one's beacon id */
    char name[MUTUALS_NAME_MAX];      /* its name, if it shares one */
    uint8_t radio_ok;                 /* 0: the radio didn't come up */
} mutuals_msg_peers_t;

_Static_assert(sizeof(mutuals_beacon_t) == 20, "beacon layout");
_Static_assert(sizeof(mutuals_msg_me_t) == 14, "me layout");
_Static_assert(sizeof(mutuals_msg_peers_t) == 20, "peers layout");
#endif
