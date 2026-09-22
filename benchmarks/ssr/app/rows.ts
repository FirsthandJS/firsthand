/**
 * The rows every implementation renders, built once and shared.
 *
 * Same data, same order, same seed. What differs between the numbers is the
 * framework and nothing else.
 */
import { createDataFactory } from '../../app/data.js';

export type Row = { id: number; label: string };

export function makeRows(count: number, seed = 7): Row[] {
  return createDataFactory(seed)(count) as Row[];
}
