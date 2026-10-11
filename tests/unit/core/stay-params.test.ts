/**
 * Stay fields checked in main against the provider's descriptors (§12.1, §12.31): defaults
 * for the use, validation of declared keys with `stayParams.<key>` issues, undeclared keys
 * passed through.
 */

import { resolveStayParams } from '@main/core/stay-params';
import { parkstayManifest } from '@main/providers/parkstay';
import { AppError } from '@main/utils/app-error';

function issuesOf(fn: () => unknown): string[] | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error.issues;
    throw error;
  }
  return undefined;
}

describe('resolveStayParams', () => {
  it("fills in the provider's defaults for the use (ParkStay snipe: any gear, one vehicle)", () => {
    expect(resolveStayParams(parkstayManifest, ['snipe', 'hold'], {})).toEqual({
      gearType: 'all',
      numVehicles: 1,
    });
    expect(resolveStayParams(parkstayManifest, ['watch'], {})).toEqual({ gearType: 'all' });
  });

  it('keeps given values and passes undeclared legacy keys through', () => {
    expect(
      resolveStayParams(parkstayManifest, ['watch'], { gearType: 'tent', parkId: '34' })
    ).toEqual({ gearType: 'tent', parkId: '34' });
  });

  it('rejects a value outside a select, a number out of range and a text off its pattern', () => {
    const error = (() => {
      try {
        resolveStayParams(parkstayManifest, ['snipe', 'hold'], {
          gearType: 'hut',
          numVehicles: 9,
          postcode: '60',
        });
      } catch (e) {
        return e as AppError;
      }
      throw new Error('expected a rejection');
    })();
    expect(error.code).toBe('VALIDATION');
    expect(error.issues).toEqual([
      'stayParams.gearType',
      'stayParams.numVehicles',
      'stayParams.postcode',
    ]);
  });

  it('rejects a value of the wrong type', () => {
    expect(
      issuesOf(() => resolveStayParams(parkstayManifest, ['snipe'], { numVehicles: '2' }))
    ).toEqual(['stayParams.numVehicles']);
  });

  it('requires a required field only for the uses it applies to', () => {
    const manifest = {
      stayFields: [
        {
          key: 'licence',
          label: 'Licence',
          type: 'text' as const,
          required: true,
          appliesTo: ['hold' as const],
        },
      ],
    };
    expect(issuesOf(() => resolveStayParams(manifest, ['hold'], {}))).toEqual([
      'stayParams.licence',
    ]);
    expect(resolveStayParams(manifest, ['watch'], {})).toEqual({});
  });
});
