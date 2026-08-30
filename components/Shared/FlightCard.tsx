import { Grid } from '@mui/material';
import moment from 'moment';
import type { FlightOffer } from '@/src/domain/flight-search';

interface FlightProps {
  flight: FlightOffer;
}

const formatDuration = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
};

const formatPrice = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
};

const FlightCard = ({ flight }: FlightProps) => (
  <Grid item xs={12}>
    <article className="border border-gray-300 rounded-lg bg-white overflow-hidden">
      <div className="border-b border-gray-200 px-5 py-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold text-gray-900">Flight offer</p>
          <p className="text-sm text-gray-500">Provider: {flight.providerId}</p>
        </div>
        <p className="text-red-600 font-bold text-xl">
          {formatPrice(flight.totalPrice.amount, flight.totalPrice.currency)}
        </p>
      </div>

      <div className="divide-y divide-gray-200">
        {flight.legs.map((leg, index) => (
          <section key={leg.id} className="p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">
                  {index === 0 ? 'Outbound' : 'Return'}
                </p>
                <p className="text-lg font-semibold text-gray-900">
                  {leg.originCode} → {leg.destinationCode}
                </p>
              </div>

              <div className="sm:text-right">
                <p className="font-medium text-gray-900">
                  {moment(leg.departureAt).format('MMM D, YYYY · HH:mm')} –{' '}
                  {moment(leg.arrivalAt).format('HH:mm')}
                </p>
                <p className="text-sm text-gray-500">
                  {formatDuration(leg.durationMinutes)} ·{' '}
                  {leg.stopCount === 0 ? 'Direct' : `${leg.stopCount} stop${leg.stopCount === 1 ? '' : 's'}`}
                </p>
              </div>
            </div>

            {leg.segments.length > 1 ? (
              <div className="mt-4 flex flex-wrap gap-2" aria-label="Flight segments">
                {leg.segments.map((segment) => (
                  <span
                    key={segment.id}
                    className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600"
                  >
                    {segment.destinationCode || 'Connection'} · {formatDuration(segment.durationMinutes)}
                  </span>
                ))}
              </div>
            ) : null}
          </section>
        ))}
      </div>
    </article>
  </Grid>
);

export default FlightCard;
