# mutuals: the FREE-WILi OG badge app (display app + main companion, one FwOGapp UF2). Built inside the wiliOGbsp
# tree by native/build.sh. The CMake targets keep their original photon_* names; NAME is what the board shows
# (USB product "FWOG display mutuals 002", the GUI / App Explorer listing, the UF2 record).
add_executable(photon_display display/main.c display/photon_assets.c display/photon_sounds.c)
target_include_directories(photon_display PRIVATE display common)
target_link_libraries(photon_display fwog_display_bsp)
fwog_display_app(photon_display
    NAME mutuals
    VERSION 002
    DESCRIPTION "mutuals: who's near you, points and levels, your connections (Cute / Formal)")

add_executable(photon_main main/main.c)
target_include_directories(photon_main PRIVATE common)
target_link_libraries(photon_main fwog_main_bsp pico_rand)
fwog_embed_display_image(photon_main)
fwog_main_app(photon_main
    NAME mutuals
    VERSION 002
    DESCRIPTION "mutuals badge: badge-to-badge radio, carrying the mutuals display app")
