/*
 * Reference driver for NRLMSISE-00: runs the original C translation (Dominik Brodowski's
 * nrlmsise-00.c / nrlmsise-00_data.c, from https://github.com/magnific0/nrlmsise-00, itself derived
 * from the official NRL Fortran code) over a fixed grid of conditions and prints CSV.
 *
 * Output is SI (switches[0] = 1): number densities in m^-3, mass density in kg/m^3, K.
 * Switches 1..23 = 1 (standard), daily-Ap mode (switches[9] = 0) — the same configuration as the
 * WebAssembly build used by Simulation (packages/physics/src/atmosphere).
 *
 * Build: gcc -O0 -ffp-contract=off -o driver driver.c nrlmsise-00.c nrlmsise-00_data.c -lm
 */
#include <stdio.h>
#include <string.h>
#include "nrlmsise-00.h"

int main(void) {
    struct nrlmsise_input input;
    struct nrlmsise_output output;
    struct nrlmsise_flags flags;
    memset(&input, 0, sizeof input);
    memset(&flags, 0, sizeof flags);
    flags.switches[0] = 1;
    for (int i = 1; i < 24; i++) flags.switches[i] = 1;

    const int doys[] = {1, 80, 172, 266, 355};
    const double secs[] = {0.0, 29000.0, 64800.0};
    const double alts[] = {0.0, 50.0, 100.0, 200.0, 400.0, 800.0, 1000.0};
    const double lats[] = {-75.0, -30.0, 0.0, 45.0, 80.0};
    const double lons[] = {-150.0, -70.0, 0.0, 100.0};
    /* solar/geomagnetic scenarios: f107A, f107, ap */
    const double sw[][3] = {{70, 70, 3}, {150, 150, 4}, {220, 210, 30}, {110, 95, 100}};

    printf("# NRLMSISE-00 C reference (magnific0/nrlmsise-00). SI units.\n");
    printf("# doy,sec,alt_km,lat_deg,lon_deg,lst_h,f107A,f107,ap,He,O,N2,O2,Ar,rho,H,N,AnomO,Texo,T\n");
    for (size_t a = 0; a < sizeof doys / sizeof *doys; a++)
    for (size_t b = 0; b < sizeof secs / sizeof *secs; b++)
    for (size_t c = 0; c < sizeof alts / sizeof *alts; c++)
    for (size_t d = 0; d < sizeof lats / sizeof *lats; d++)
    for (size_t e = 0; e < sizeof lons / sizeof *lons; e++)
    for (size_t f = 0; f < sizeof sw / sizeof *sw; f++) {
        /* a thinned, deterministic subset keeps the file small while covering every dimension */
        if (((a * 7 + b * 5 + c * 3 + d * 2 + e + f) % 4) != 0) continue;
        double lst = secs[b] / 3600.0 + lons[e] / 15.0;
        while (lst < 0) lst += 24.0;
        while (lst >= 24.0) lst -= 24.0;
        input.year = 0;
        input.doy = doys[a];
        input.sec = secs[b];
        input.alt = alts[c];
        input.g_lat = lats[d];
        input.g_long = lons[e];
        input.lst = lst;
        input.f107A = sw[f][0];
        input.f107 = sw[f][1];
        input.ap = sw[f][2];
        gtd7(&input, &flags, &output);
        printf("%d,%.1f,%.1f,%.1f,%.1f,%.6f,%.1f,%.1f,%.1f,", input.doy, input.sec, input.alt,
               input.g_lat, input.g_long, input.lst, input.f107A, input.f107, input.ap);
        printf("%.12e,%.12e,%.12e,%.12e,%.12e,%.12e,%.12e,%.12e,%.12e,%.12e,%.12e\n",
               output.d[0], output.d[1], output.d[2], output.d[3], output.d[4], output.d[5],
               output.d[6], output.d[7], output.d[8], output.t[0], output.t[1]);
    }
    return 0;
}
