import BookingForm from '@/components/Shared/BookingForm';

export default function Home() {
  return (
    <main className="background-image-1 min-h-screen w-full bg-cover bg-center bg-no-repeat">
      <div className="min-h-screen bg-black/30 px-4 py-16">
        <div className="mx-auto flex max-w-5xl flex-col items-center text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-white/80">
            My Booking Engine
          </p>
          <h1 className="mt-3 max-w-3xl text-3xl font-bold text-white sm:text-5xl">
            Search live flight availability
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-white/90 sm:text-base">
            Compare available itineraries using the currently configured flight provider.
          </p>
          <BookingForm />
        </div>
      </div>
    </main>
  );
}
