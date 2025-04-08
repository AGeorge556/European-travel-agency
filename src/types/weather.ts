export interface WeatherData {
  timepoint: number;
  temp2m: number;
  prec_type: string;
  rh2m: string;
  wind10m_direction: string;
  wind10m_speed: number;
  weather: string;
}

export interface WeatherResponse {
  dataseries: WeatherData[];
  init: string;
  product: string;
}

export interface City {
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  description?: string;
  flag: string;
  timezone: string;
} 