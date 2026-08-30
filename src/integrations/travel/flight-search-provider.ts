import type { FlightSearchRequest, FlightSearchResult } from '@/src/domain/flight-search';

export type TravelProviderCapability = 'flight-search';

export interface FlightSearchProvider {
  readonly id: string;
  readonly capabilities: readonly TravelProviderCapability[];
  search(request: FlightSearchRequest): Promise<FlightSearchResult>;
}
