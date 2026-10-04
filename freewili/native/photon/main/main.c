/*
 * mutuals, main CPU: badge-to-badge proximity over the CC1101 sub-GHz radios (the OG has no Bluetooth).
 *
 *   - Brings the display CPU up (fwog_display_update_run), which also opens the inter-CPU link.
 *   - Radio CS0 transmits a small beacon about every 0.4 s (jittered so two badges don't keep colliding);
 *     radio CS1 listens the rest of the time. Our own beacon is recognised by its id and ignored.
 *   - Tells the display CPU about the strongest badge it hears (MUTUALS_MSG_PEERS), and takes "who I am /
 *     am I discoverable" from it (MUTUALS_MSG_ME). Not discoverable = no beacon at all.
 *   - With only one working radio, it does both jobs (listen, pause to beacon, listen again).
 *
 * Built with the FREE-WILi wiliOGbsp (see native/build.sh). See common/mutuals_link.h for the formats.
 */
#include <string.h>
#include "fwog_main.h"
#include "common/link/link_frame.h"
#include "common/link/link_uart.h"
#include "mutuals_link.h"
#include "pico/rand.h"
#include "pico/stdlib.h"

/* Every main app must kick the 8.3 s watchdog board_init() arms (see bsp/main_cpu/watchdog/watchdog.h). */
FWOG_WATCHDOG_DEFAULT();

#define RADIO_SPI_HZ 1000000u      /* the BSP bench's conservative bus rate */
#define BEACON_MS 400u
#define PEER_TIMEOUT_MS 2500u
#define REPORT_MS 250u
#define REARM_MS 2000u             /* re-enter RX now and then, in case the receiver wedged */
#define MAX_PEERS 8

static cc1101_t radio[2];
static bool radio_up[2];
static cc1101_t *tx_radio, *rx_radio;

static uint8_t my_id[4];
static bool discoverable = true;
static char my_name[MUTUALS_NAME_MAX];

static struct {
    uint8_t id[4];
    char name[MUTUALS_NAME_MAX];
    int rssi_x4;                   /* smoothed RSSI, dBm x 4 */
    uint32_t last;
    bool used;
} peers[MAX_PEERS];

static bool radio_start(cc1101_t *r) {
    board_watchdog_kick();
    bool ok = cc1101_bringup(r);
    ok = ok && cc1101_set_frequency(r, MUTUALS_RADIO_HZ);
    ok = ok && cc1101_set_power(r, MUTUALS_RADIO_DBM);
    ok = ok && cc1101_idle(r);
    return ok;
}

static void rx_arm(void) {
    if (!rx_radio) return;
    cc1101_idle(rx_radio);
    cc1101_flush_rx(rx_radio);
    cc1101_rx(rx_radio);
}

static void send_beacon(void) {
    if (!tx_radio || !discoverable) return;
    mutuals_beacon_t b = {{MUTUALS_BEACON_MAGIC0, MUTUALS_BEACON_MAGIC1}, MUTUALS_BEACON_VERSION, {0}, 0, {0}};
    memcpy(b.id, my_id, sizeof b.id);
    b.name_len = (uint8_t)strnlen(my_name, MUTUALS_NAME_MAX);
    memcpy(b.name, my_name, b.name_len);
    cc1101_send_packet(tx_radio, (const uint8_t *)&b, (uint8_t)(sizeof b - MUTUALS_NAME_MAX + b.name_len));
    if (tx_radio == rx_radio) rx_arm();  /* one radio: go back to listening */
}

static void heard(const mutuals_beacon_t *b, unsigned len, int rssi, uint32_t now) {
    if (len < sizeof *b - MUTUALS_NAME_MAX || b->magic[0] != MUTUALS_BEACON_MAGIC0 ||
        b->magic[1] != MUTUALS_BEACON_MAGIC1 || b->version != MUTUALS_BEACON_VERSION)
        return;
    if (memcmp(b->id, my_id, sizeof my_id) == 0) return;  /* our own beacon, from the other radio */
    int slot = -1, oldest = 0;
    for (int i = 0; i < MAX_PEERS; ++i) {
        if (peers[i].used && memcmp(peers[i].id, b->id, 4) == 0) { slot = i; break; }
        if (!peers[i].used) { if (slot < 0) slot = i; }
        else if (peers[i].last < peers[oldest].last) oldest = i;
    }
    if (slot < 0) slot = oldest;
    if (!peers[slot].used || memcmp(peers[slot].id, b->id, 4) != 0) {
        memset(&peers[slot], 0, sizeof peers[slot]);
        memcpy(peers[slot].id, b->id, 4);
        peers[slot].rssi_x4 = rssi * 4;
        peers[slot].used = true;
    } else {
        peers[slot].rssi_x4 += (rssi * 4 - peers[slot].rssi_x4) / 3;  /* smooth out fading */
    }
    unsigned n = b->name_len;
    if (n > MUTUALS_NAME_MAX) n = MUTUALS_NAME_MAX;
    if (n > len - (sizeof *b - MUTUALS_NAME_MAX)) n = len - (sizeof *b - MUTUALS_NAME_MAX);
    memset(peers[slot].name, 0, MUTUALS_NAME_MAX);
    memcpy(peers[slot].name, b->name, n);
    peers[slot].last = now;
}

static void poll_radio(uint32_t now) {
    if (!rx_radio) return;
    const int raw = cc1101_rx_bytes_available(rx_radio);
    if (raw <= 0) return;
    if (raw & 0x80) { rx_arm(); return; }        /* FIFO overflow */
    const unsigned n = (unsigned)(raw & 0x7F);
    if (n < 3u) return;                          /* still arriving */
    uint8_t buf[64];
    const unsigned want = n > sizeof buf ? (unsigned)sizeof buf : n;
    if (cc1101_receive_packet(rx_radio, buf, (uint8_t)want) >= 0) {
        /* [length][payload ...][RSSI][LQI|CRC_OK] (APPEND_STATUS) */
        const unsigned len = buf[0];
        if (len + 3u <= want && cc1101_lqi_crc_ok(buf[len + 2u]))
            heard((const mutuals_beacon_t *)&buf[1], len, cc1101_rssi_dbm((int8_t)buf[len + 1u]), now);
    }
    rx_arm();
}

static void report(uint32_t now) {
    mutuals_msg_peers_t m;
    memset(&m, 0, sizeof m);
    m.type = MUTUALS_MSG_PEERS;
    m.radio_ok = rx_radio != NULL;
    int best = -1;
    for (int i = 0; i < MAX_PEERS; ++i) {
        if (!peers[i].used) continue;
        if (now - peers[i].last > PEER_TIMEOUT_MS) { peers[i].used = false; continue; }
        m.count++;
        if (best < 0 || peers[i].rssi_x4 > peers[best].rssi_x4) best = i;
    }
    if (best >= 0) {
        m.rssi = (int8_t)(peers[best].rssi_x4 / 4);
        memcpy(m.id, peers[best].id, 4);
        memcpy(m.name, peers[best].name, MUTUALS_NAME_MAX);
    }
    fwog_link_uart_send_frame(&m, sizeof m);
}

static void handle_link(const uint8_t *p, size_t len) {
    if (len == sizeof(mutuals_msg_me_t) && p[0] == MUTUALS_MSG_ME) {
        const mutuals_msg_me_t *m = (const mutuals_msg_me_t *)p;
        discoverable = m->discoverable != 0;
        memcpy(my_name, m->name, MUTUALS_NAME_MAX);
    }
}

int main(void) {
    board_init();

    /* Brings the display up: link, HELLO, reflash if the embedded image differs, then RUN. It performs
       board_release_display() itself, so applications must NOT call it separately. */
    fwog_display_update_run();

    const uint32_t r = get_rand_32();
    memcpy(my_id, &r, sizeof my_id);

    cc1101_bus_init(RADIO_SPI_HZ);
    cc1101_bind(&radio[0], CC1101_RADIO_CS0);
    cc1101_bind(&radio[1], CC1101_RADIO_CS1);
    radio_up[0] = radio_start(&radio[0]);
    radio_up[1] = radio_start(&radio[1]);
    tx_radio = radio_up[0] ? &radio[0] : radio_up[1] ? &radio[1] : NULL;
    rx_radio = radio_up[1] ? &radio[1] : radio_up[0] ? &radio[0] : NULL;
    rx_arm();

    static fwog_link_rx_t link_rx;  /* 4 KB frame buffer: static, not on the stack */
    fwog_link_rx_init(&link_rx);

    uint32_t now = to_ms_since_boot(get_absolute_time());
    uint32_t next_beacon = now + 300u, next_report = now, next_rearm = now + REARM_MS;
    while (true) {
        board_watchdog_kick();  /* required: see watchdog.h */
        now = to_ms_since_boot(get_absolute_time());

        uint8_t b;
        size_t len;
        while (fwog_link_uart_read(&b))
            if (fwog_link_rx_byte(&link_rx, b, &len)) handle_link(link_rx.buf, len);

        poll_radio(now);
        if ((int32_t)(now - next_beacon) >= 0) {
            send_beacon();
            next_beacon = now + BEACON_MS - 100u + get_rand_32() % 200u;
        }
        if ((int32_t)(now - next_report) >= 0) { report(now); next_report = now + REPORT_MS; }
        if ((int32_t)(now - next_rearm) >= 0) { rx_arm(); next_rearm = now + REARM_MS; }
        sleep_ms(1);
    }
}
