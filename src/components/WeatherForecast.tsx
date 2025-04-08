import React, { useState, useEffect } from 'react';
import {
  Container,
  Card,
  CardContent,
  Typography,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Box,
  CircularProgress,
  SelectChangeEvent,
  Paper,
  Fade,
  Grow,
  useTheme,
  alpha,
  Zoom,
  Slide,
  useMediaQuery,
  Chip,
} from '@mui/material';
import { globalCities } from '../data/globalCities';
import { fetchWeatherData } from '../utils/api';
import { WeatherData, City } from '../types/weather';
import Earth from './Earth';

const WeatherForecast: React.FC = () => {
  const [selectedCity, setSelectedCity] = useState<City | null>(null);
  const [weatherData, setWeatherData] = useState<WeatherData[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const theme = useTheme();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  // Update current time every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      if (!selectedCity) return;
      
      setLoading(true);
      setError(null);
      
      try {
        const response = await fetchWeatherData(selectedCity.latitude, selectedCity.longitude);
        console.log('Weather data:', response.dataseries); // Debug log
        setWeatherData(response.dataseries);
      } catch (err) {
        setError('Failed to fetch weather data. Please try again later.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [selectedCity]);

  const getWeatherIcon = (weather: string) => {
    // You can expand this mapping based on the API's weather codes
    switch (weather) {
      case 'clear':
        return '☀️';
      case 'pcloudy':
        return '⛅';
      case 'mcloudy':
      case 'cloudy':
        return '☁️';
      case 'rain':
        return '🌧️';
      case 'snow':
        return '❄️';
      default:
        return '🌤️';
    }
  };

  const formatTime = (timepoint: number) => {
    // Convert timepoint (hours from now) to a readable time
    const now = new Date();
    const futureTime = new Date(now.getTime() + timepoint * 60 * 60 * 1000);
    return futureTime.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const getDailyForecast = () => {
    if (!weatherData) return [];
    
    // Group data by day (every 24 hours)
    const dailyData: WeatherData[] = [];
    for (let i = 0; i < weatherData.length; i += 8) { // 8 timepoints per day (3-hour intervals)
      if (i < weatherData.length) {
        dailyData.push(weatherData[i]);
      }
    }
    
    return dailyData;
  };

  const handleCityChange = (event: SelectChangeEvent<string>) => {
    const city = globalCities.find(c => c.name === event.target.value);
    setSelectedCity(city || null);
  };

  // Format local time for the selected city
  const getLocalTime = () => {
    if (!selectedCity) return '';
    
    try {
      return new Date().toLocaleTimeString('en-US', { 
        timeZone: selectedCity.timezone,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
    } catch (error) {
      console.error('Error formatting time:', error);
      return '';
    }
  };

  // Get today's weather summary
  const getTodaySummary = () => {
    if (!weatherData || weatherData.length === 0) return null;
    
    const today = weatherData[0];
    return {
      temp: today.temp2m,
      weather: today.weather,
      humidity: today.rh2m
    };
  };

  return (
    <Box sx={{ position: 'relative', minHeight: '100vh', overflow: 'hidden' }}>
      {/* 3D Earth Background */}
      <Earth />
      
      {/* Content Overlay */}
      <Container maxWidth="lg" sx={{ py: 4, position: 'relative', zIndex: 1 }}>
        <Fade in={true} timeout={1000}>
          <Paper 
            elevation={3} 
            sx={{ 
              p: { xs: 2, sm: 4 }, 
              borderRadius: 2,
              background: `linear-gradient(135deg, ${alpha(theme.palette.background.paper, 0.6)}, ${alpha(theme.palette.background.paper, 0.7)})`,
              backdropFilter: 'blur(5px)',
              boxShadow: `0 8px 32px 0 ${alpha(theme.palette.primary.main, 0.2)}`,
            }}
          >
            <Typography 
              variant="h3" 
              component="h1" 
              gutterBottom 
              align="center"
              sx={{ 
                fontWeight: 'bold',
                background: `linear-gradient(45deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
                backgroundClip: 'text',
                textFillColor: 'transparent',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                mb: 4,
                textShadow: `0 2px 10px ${alpha(theme.palette.primary.main, 0.3)}`,
                fontSize: { xs: '1.8rem', sm: '2.5rem', md: '3rem' }
              }}
            >
              Global Weather Forecast
            </Typography>
            
            {/* Current Time Display */}
            <Box sx={{ textAlign: 'center', mb: 3 }}>
              <Typography variant="h6" color="text.secondary">
                {currentTime.toLocaleDateString('en-US', { 
                  weekday: 'long', 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                })}
              </Typography>
              <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
                {currentTime.toLocaleTimeString('en-US', { 
                  hour: '2-digit', 
                  minute: '2-digit', 
                  second: '2-digit',
                  hour12: true 
                })}
              </Typography>
            </Box>
            
            <Slide direction="down" in={true} timeout={800}>
              <Box sx={{ mb: 4 }}>
                <FormControl fullWidth>
                  <InputLabel id="city-select-label">Select a City</InputLabel>
                  <Select
                    labelId="city-select-label"
                    value={selectedCity?.name || ''}
                    label="Select a City"
                    onChange={handleCityChange}
                    sx={{ 
                      borderRadius: 2,
                      '& .MuiOutlinedInput-notchedOutline': {
                        borderColor: alpha(theme.palette.primary.main, 0.3),
                      },
                      '&:hover .MuiOutlinedInput-notchedOutline': {
                        borderColor: theme.palette.primary.main,
                      },
                      transition: 'all 0.3s ease',
                      '&:hover': {
                        transform: 'translateY(-2px)',
                        boxShadow: `0 4px 8px ${alpha(theme.palette.primary.main, 0.2)}`,
                      },
                    }}
                  >
                    {globalCities.map((city) => (
                      <MenuItem key={city.name} value={city.name}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="body1">{city.flag}</Typography>
                          <Typography variant="body1">{city.name}, {city.country}</Typography>
                        </Box>
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
            </Slide>

            {selectedCity && (
              <Fade in={true} timeout={800}>
                <Box sx={{ mb: 4, textAlign: 'center' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mb: 1 }}>
                    <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
                      {selectedCity.flag} {selectedCity.name}, {selectedCity.country}
                    </Typography>
                  </Box>
                  <Typography variant="body1" color="text.secondary" sx={{ maxWidth: '600px', mx: 'auto' }}>
                    {selectedCity.description}
                  </Typography>
                  <Typography variant="h6" sx={{ mt: 1, color: 'primary.main' }}>
                    Local Time: {getLocalTime()}
                  </Typography>
                </Box>
              </Fade>
            )}

            {loading && (
              <Box display="flex" justifyContent="center" my={4}>
                <CircularProgress size={60} thickness={4} />
              </Box>
            )}

            {error && (
              <Typography color="error" align="center" gutterBottom>
                {error}
              </Typography>
            )}

            {/* Today's Weather Summary */}
            {weatherData && !loading && getTodaySummary() && (
              <Fade in={true} timeout={800}>
                <Card 
                  sx={{ 
                    mb: 4, 
                    borderRadius: 2,
                    background: `linear-gradient(135deg, ${alpha(theme.palette.primary.light, 0.1)}, ${alpha(theme.palette.primary.main, 0.05)})`,
                    border: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
                  }}
                >
                  <CardContent>
                    <Box sx={{ 
                      display: 'flex', 
                      flexDirection: { xs: 'column', sm: 'row' },
                      alignItems: 'center', 
                      gap: 2 
                    }}>
                      <Box sx={{ flex: { xs: '1 1 100%', sm: '0 0 33%' }, textAlign: 'center' }}>
                        <Typography variant="h1" sx={{ fontSize: '4rem' }}>
                          {getWeatherIcon(getTodaySummary()!.weather)}
                        </Typography>
                      </Box>
                      <Box sx={{ flex: { xs: '1 1 100%', sm: '0 0 67%' } }}>
                        <Typography variant="h3" gutterBottom>
                          {getTodaySummary()!.temp}°C
                        </Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 2 }}>
                          <Chip 
                            icon={<Typography>💧</Typography>} 
                            label={`Humidity: ${getTodaySummary()!.humidity}`} 
                            variant="outlined" 
                          />
                        </Box>
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              </Fade>
            )}

            {/* 7-Day Forecast */}
            {weatherData && !loading && (
              <Box sx={{ 
                display: 'grid', 
                gridTemplateColumns: {
                  xs: '1fr',
                  sm: 'repeat(2, 1fr)',
                  md: 'repeat(3, 1fr)',
                  lg: 'repeat(4, 1fr)'
                },
                gap: 3
              }}>
                {getDailyForecast().slice(0, 7).map((day, index) => (
                  <Grow in={true} timeout={500 + index * 100} key={index}>
                    <Card 
                      sx={{ 
                        borderRadius: 2,
                        overflow: 'hidden',
                        transition: 'all 0.3s ease',
                        '&:hover': {
                          transform: 'translateY(-8px)',
                          boxShadow: `0 12px 20px ${alpha(theme.palette.primary.main, 0.2)}`,
                        },
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        background: `linear-gradient(135deg, ${alpha(theme.palette.background.paper, 0.8)}, ${alpha(theme.palette.primary.light, 0.1)})`,
                        backdropFilter: 'blur(5px)',
                        border: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
                      }}
                    >
                      <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', p: 3 }}>
                        <Typography variant="h6" gutterBottom sx={{ fontWeight: 'bold' }}>
                          {formatTime(day.timepoint)}
                        </Typography>
                        <Zoom in={true} timeout={800 + index * 100}>
                          <Typography 
                            variant="h1" 
                            align="center" 
                            gutterBottom
                            sx={{ 
                              fontSize: '4rem',
                              animation: 'pulse 2s infinite',
                              '@keyframes pulse': {
                                '0%': { transform: 'scale(1)' },
                                '50%': { transform: 'scale(1.1)' },
                                '100%': { transform: 'scale(1)' },
                              }
                            }}
                          >
                            {getWeatherIcon(day.weather)}
                          </Typography>
                        </Zoom>
                        <Typography variant="h5" sx={{ fontWeight: 'bold', my: 1 }}>
                          {day.temp2m}°C
                        </Typography>
                        <Typography variant="body1" sx={{ mt: 1 }}>
                          Humidity: {day.rh2m}
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grow>
                ))}
              </Box>
            )}
          </Paper>
        </Fade>
      </Container>
    </Box>
  );
};

export default WeatherForecast; 