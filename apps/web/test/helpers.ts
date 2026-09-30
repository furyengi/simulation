/* eslint-disable no-restricted-imports -- test-only bridge to the physics core */
import { hermitePosition, rot3 } from '@simulation/physics';
import { matrixToQuaternion } from '@simulation/environment';

export { hermitePosition, rot3 };
export const matrixToQuaternion0 = (m: Parameters<typeof matrixToQuaternion>[0]) =>
  matrixToQuaternion(m);
