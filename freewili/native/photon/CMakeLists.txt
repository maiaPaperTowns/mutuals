# Photon Pup: pixel-art networking Tamagotchi on the FREE-WILi OG's own LCD (display app + main companion,
# one FwOGapp UF2). Built inside the wiliOGbsp tree by native/build.sh.
add_executable(photon_display display/main.c display/photon_assets.c display/photon_sounds.c)
target_include_directories(photon_display PRIVATE display)
target_link_libraries(photon_display fwog_display_bsp)
fwog_display_app(photon_display
    VERSION 001
    DESCRIPTION "Photon Pup: pixel-art networking Tamagotchi (catch matches for a double yes)")

add_executable(photon_main main/main.c)
target_link_libraries(photon_main fwog_main_bsp)
fwog_embed_display_image(photon_main)
fwog_main_app(photon_main
    VERSION 001
    DESCRIPTION "Photon Pup main app carrying the matching display firmware")
