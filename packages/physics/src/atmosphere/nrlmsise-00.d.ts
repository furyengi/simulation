// Ambient types for the `nrlmsise-00` npm package (Emscripten/WASM build of the C NRLMSISE-00).
// The package ships without TypeScript declarations. All outputs are SI: number densities in m^-3,
// mass density in kg/m^3, temperatures in K (the wrapper sets the model's SI switch).
declare module 'nrlmsise-00' {
  export interface NrlmsiseModel {
    /**
     * @param doy day of year (1–366)
     * @param sec seconds in the UT day
     * @param alt altitude, km
     * @param gLat geodetic latitude, degrees
     * @param gLong longitude, degrees east
     * @param lst local apparent solar time, hours
     * @param f107A 81-day average F10.7, sfu
     * @param f107 daily F10.7 (previous day), sfu
     * @param ap daily Ap magnetic index
     */
    run_model(
      doy: number,
      sec: number,
      alt: number,
      gLat: number,
      gLong: number,
      lst: number,
      f107A: number,
      f107: number,
      ap: number,
    ): void;
    readonly HE: number;
    readonly O: number;
    readonly N2: number;
    readonly O2: number;
    readonly AR: number;
    readonly TotalMassDensity: number;
    readonly H: number;
    readonly N: number;
    readonly AnomalousOxygen: number;
    readonly ExosphericTemp: number;
    readonly TemperatureAtAlt: number;
    delete?(): void;
  }
  const factory: () => Promise<{ NrlmsiseModel: new () => NrlmsiseModel }>;
  export default factory;
}
