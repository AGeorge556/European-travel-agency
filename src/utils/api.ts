import axios from 'axios';
import { WeatherResponse } from '../types/weather';

const BASE_URL = 'https://www.7timer.info/bin/api.pl';

export const fetchWeatherData = async (latitude: number, longitude: number): Promise<WeatherResponse> => {
  try {
    const response = await axios.get(BASE_URL, {
      params: {
        lon: longitude,
        lat: latitude,
        product: 'civil',
        output: 'json',
      },
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching weather data:', error);
    throw error;
  }
}; 