'use client';

import React, { useState } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  FormControl,
  FormControlLabel,
  Grid,
  InputAdornment,
  Radio,
  RadioGroup,
  TextField,
} from '@mui/material';
import { DateRange, FlightTakeoffRounded, Person } from '@mui/icons-material';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import dayjs, { Dayjs } from 'dayjs';
import Airports from '@/data/airports.json';

type TripType = 'round-trip' | 'one-way';

interface BookingInfo {
  departure: string;
  destination: string;
  adults: number;
  departureDate: string;
  returnDate: string;
}

interface BookingErrors {
  departure?: string;
  destination?: string;
  adults?: string;
  departureDate?: string;
  returnDate?: string;
}

const airportOptions = Airports.map(
  (airport) => `${airport.iata_code} ${airport.country} - ${airport.city} - ${airport.name}`,
);

const BookingForm = () => {
  const [tripType, setTripType] = useState<TripType>('round-trip');
  const [departureDate, setDepartureDate] = useState<Dayjs | null>(null);
  const [returnDate, setReturnDate] = useState<Dayjs | null>(null);
  const [errors, setErrors] = useState<BookingErrors>({});
  const [bookingInfo, setBookingInfo] = useState<BookingInfo>({
    departure: '',
    destination: '',
    adults: 1,
    departureDate: '',
    returnDate: '',
  });

  const updateBookingInfo = <Key extends keyof BookingInfo>(
    key: Key,
    value: BookingInfo[Key],
  ) => {
    setBookingInfo((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const validate = (): BookingErrors => {
    const nextErrors: BookingErrors = {};

    if (!bookingInfo.departure) {
      nextErrors.departure = 'Select a departure airport.';
    }

    if (!bookingInfo.destination) {
      nextErrors.destination = 'Select a destination airport.';
    }

    if (bookingInfo.departure && bookingInfo.destination) {
      const originCode = bookingInfo.departure.split(' ')[0];
      const destinationCode = bookingInfo.destination.split(' ')[0];
      if (originCode === destinationCode) {
        nextErrors.destination = 'Choose a different destination airport.';
      }
    }

    if (!bookingInfo.departureDate) {
      nextErrors.departureDate = 'Select a departure date.';
    }

    if (tripType === 'round-trip' && !bookingInfo.returnDate) {
      nextErrors.returnDate = 'Select a return date.';
    }

    if (!Number.isInteger(bookingInfo.adults) || bookingInfo.adults < 1 || bookingInfo.adults > 9) {
      nextErrors.adults = 'Adults must be between 1 and 9.';
    }

    return nextErrors;
  };

  const searchFlights = () => {
    const nextErrors = validate();
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }

    const params = new URLSearchParams({
      departure: bookingInfo.departure.split(' ')[0],
      returning: bookingInfo.destination.split(' ')[0],
      departureDate: bookingInfo.departureDate,
      persons: String(bookingInfo.adults),
    });

    if (tripType === 'round-trip' && bookingInfo.returnDate) {
      params.set('returningDate', bookingInfo.returnDate);
    }

    window.location.assign(`/ticket-booking?${params.toString()}`);
  };

  return (
    <Box
      sx={{
        borderRadius: '1rem',
        backgroundColor: 'white',
        marginTop: 6,
        p: { xs: 2, sm: 3 },
        width: { xs: 'calc(100vw - 2rem)', sm: 'min(760px, calc(100vw - 3rem))' },
      }}
    >
      <Box component="form" noValidate onSubmit={(event) => event.preventDefault()}>
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <FormControl>
              <RadioGroup
                row
                value={tripType}
                onChange={(event) => {
                  const nextTripType = event.target.value as TripType;
                  setTripType(nextTripType);
                  if (nextTripType === 'one-way') {
                    setReturnDate(null);
                    updateBookingInfo('returnDate', '');
                  }
                }}
              >
                <FormControlLabel value="round-trip" control={<Radio />} label="Round trip" />
                <FormControlLabel value="one-way" control={<Radio />} label="One way" />
              </RadioGroup>
            </FormControl>
          </Grid>

          <Grid item md={6} xs={12}>
            <Autocomplete
              value={bookingInfo.departure || null}
              onChange={(_, value) => updateBookingInfo('departure', value ?? '')}
              options={airportOptions}
              renderInput={(params) => (
                <TextField
                  {...params}
                  error={Boolean(errors.departure)}
                  helperText={errors.departure}
                  InputProps={{
                    ...params.InputProps,
                    startAdornment: (
                      <InputAdornment position="start">
                        <FlightTakeoffRounded />
                      </InputAdornment>
                    ),
                  }}
                  label="Departing from"
                />
              )}
            />
          </Grid>

          <Grid item md={6} xs={12}>
            <Autocomplete
              value={bookingInfo.destination || null}
              onChange={(_, value) => updateBookingInfo('destination', value ?? '')}
              options={airportOptions}
              renderInput={(params) => (
                <TextField
                  {...params}
                  error={Boolean(errors.destination)}
                  helperText={errors.destination}
                  InputProps={{
                    ...params.InputProps,
                    startAdornment: (
                      <InputAdornment position="start">
                        <FlightTakeoffRounded />
                      </InputAdornment>
                    ),
                  }}
                  label="Going to"
                />
              )}
            />
          </Grid>

          <Grid item md={tripType === 'round-trip' ? 6 : 12} xs={12}>
            <LocalizationProvider dateAdapter={AdapterDayjs}>
              <DatePicker
                disablePast
                label="Departing"
                value={departureDate}
                onChange={(value) => {
                  setDepartureDate(value);
                  updateBookingInfo(
                    'departureDate',
                    value ? dayjs(value).format('YYYY-MM-DD') : '',
                  );

                  if (returnDate && value && returnDate.isBefore(value, 'day')) {
                    setReturnDate(null);
                    updateBookingInfo('returnDate', '');
                  }
                }}
                renderInput={(params) => (
                  <TextField
                    fullWidth
                    {...params}
                    error={Boolean(errors.departureDate)}
                    helperText={errors.departureDate}
                    InputProps={{
                      ...params.InputProps,
                      startAdornment: (
                        <InputAdornment position="start">
                          <DateRange />
                        </InputAdornment>
                      ),
                    }}
                  />
                )}
              />
            </LocalizationProvider>
          </Grid>

          {tripType === 'round-trip' ? (
            <Grid item md={6} xs={12}>
              <LocalizationProvider dateAdapter={AdapterDayjs}>
                <DatePicker
                  disablePast
                  minDate={departureDate ?? undefined}
                  label="Returning"
                  value={returnDate}
                  onChange={(value) => {
                    setReturnDate(value);
                    updateBookingInfo('returnDate', value ? dayjs(value).format('YYYY-MM-DD') : '');
                  }}
                  renderInput={(params) => (
                    <TextField
                      fullWidth
                      {...params}
                      error={Boolean(errors.returnDate)}
                      helperText={errors.returnDate}
                      InputProps={{
                        ...params.InputProps,
                        startAdornment: (
                          <InputAdornment position="start">
                            <DateRange />
                          </InputAdornment>
                        ),
                      }}
                    />
                  )}
                />
              </LocalizationProvider>
            </Grid>
          ) : null}

          <Grid item xs={12}>
            <TextField
              type="number"
              label="Adults"
              value={bookingInfo.adults}
              error={Boolean(errors.adults)}
              helperText={errors.adults ?? 'Maximum 9 travelers per search.'}
              onChange={(event) => updateBookingInfo('adults', Number(event.target.value))}
              inputProps={{ min: 1, max: 9, step: 1 }}
              fullWidth
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Person />
                  </InputAdornment>
                ),
              }}
            />
          </Grid>

          <Grid item xs={12}>
            <Button type="button" onClick={searchFlights} fullWidth variant="contained" size="large">
              Search flights
            </Button>
          </Grid>
        </Grid>
      </Box>
    </Box>
  );
};

export default BookingForm;
