import { CarFront, Dog, MapPin, ShowerHead, Toilet } from 'lucide-react';
import { amenityIcon } from './amenityIcons';

describe('amenityIcon', () => {
  it("maps ParkStay's facilities to their icons", () => {
    expect(amenityIcon('Dogs permitted')).toBe(Dog);
    expect(amenityIcon('Toilet')).toBe(Toilet);
    expect(amenityIcon('Road access for 2WD/SUV')).toBe(CarFront);
  });

  it('recognises other providers’ wording for the same thing', () => {
    expect(amenityIcon('Toilets')).toBe(Toilet);
    expect(amenityIcon('Dog friendly')).toBe(Dog);
    expect(amenityIcon('Hot showers')).toBe(ShowerHead);
  });

  it('falls back to a map pin for anything else', () => {
    expect(amenityIcon('Heated pool')).toBe(MapPin);
    expect(amenityIcon('')).toBe(MapPin);
  });
});
