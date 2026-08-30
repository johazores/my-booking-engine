export interface FlightSearchRequest {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  adults: number;
}

export interface Money {
  amount: number;
  currency: string;
}

export interface FlightSegment {
  id: string;
  durationMinutes: number;
  destinationCode: string;
}

export interface FlightLeg {
  id: string;
  departureAt: string;
  arrivalAt: string;
  originCode: string;
  destinationCode: string;
  durationMinutes: number;
  stopCount: number;
  segments: FlightSegment[];
}

export interface FlightOffer {
  id: string;
  providerId: string;
  legs: FlightLeg[];
  totalPrice: Money;
}

export interface FlightSearchResult {
  providerId: string;
  offers: FlightOffer[];
}
