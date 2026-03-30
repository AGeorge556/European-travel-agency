import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Typography, CircularProgress, InputBase } from '@mui/material';
import { globalCities } from '../data/globalCities';
import { fetchWeatherData } from '../utils/api';
import { WeatherData, City } from '../types/weather';
import Earth from './Earth';

// ── Nominatim result shape ────────────────────────────────────────────────────
interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  address: {
    city?: string;
    town?: string;
    village?: string;
    suburb?: string;
    county?: string;
    state?: string;
    country?: string;
    country_code?: string;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const weatherIcon = (code: string): string => ({
  clear: '☀️', pcloudy: '⛅', mcloudy: '🌥️', cloudy: '☁️',
  rain: '🌧️', snow: '❄️', ts: '⛈️', tsrain: '⛈️',
  lightrain: '🌦️', lightsnow: '🌨️', oshower: '🌦️', ishower: '🌦️',
  humid: '💧', windy: '🌬️',
}[code] ?? '🌤️');

const windLabel = (speed: number): string =>
  ['', 'Calm', 'Light', 'Moderate', 'Fresh', 'Strong', 'Gale', 'Violent', 'Hurricane'][
    Math.min(speed, 8)
  ] ?? '';

const formatDay = (timepoint: number): string => {
  const d = new Date(Date.now() + timepoint * 3_600_000);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

/** Build a flag emoji from a 2-letter ISO country code */
const flagEmoji = (alpha2: string): string => {
  if (!alpha2 || alpha2.length < 2) return '🌍';
  try {
    const base = 0x1F1E6 - 65;
    const c = alpha2.toUpperCase();
    return String.fromCodePoint(base + c.charCodeAt(0)) +
           String.fromCodePoint(base + c.charCodeAt(1));
  } catch { return '🌍'; }
};

/** Rough timezone from longitude (Etc/GMT±N).
 *  Note: IANA Etc/GMT sign is INVERTED vs UTC offset. */
const estTimezone = (lon: number): string => {
  const n = -Math.round(lon / 15);   // e.g. lon=+2 → -0 → 'UTC'
  if (n === 0) return 'UTC';
  return `Etc/GMT${n > 0 ? '+' : ''}${n}`;
};

/** Best display name from a Nominatim address object */
const bestName = (r: NominatimResult): string =>
  r.address.city     ||
  r.address.town     ||
  r.address.village  ||
  r.address.suburb   ||
  r.address.county   ||
  r.address.state    ||
  r.display_name.split(',')[0];

// ── Design tokens ─────────────────────────────────────────────────────────────
const ACCENT   = '#4fc3f7';
const GOLD     = '#ffd740';
const BORDER   = 'rgba(79, 195, 247, 0.15)';
const CARD_BG  = 'rgba(14, 28, 60, 0.55)';
const PANEL_BG = 'rgba(6, 12, 28, 0.94)';

// ── Component ─────────────────────────────────────────────────────────────────
const WeatherForecast: React.FC = () => {
  const [selectedCity, setSelectedCity] = useState<City | null>(null);
  const [weatherData, setWeatherData]   = useState<WeatherData[] | null>(null);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [time, setTime]                 = useState(new Date());

  // Search state
  const [query, setQuery]               = useState('');
  const [results, setResults]           = useState<NominatimResult[]>([]);
  const [searching, setSearching]       = useState(false);
  const [showResults, setShowResults]   = useState(false);
  const searchTimer                     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchBoxRef                    = useRef<HTMLDivElement>(null);

  // Live clock
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Fetch weather on city change
  useEffect(() => {
    if (!selectedCity) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchWeatherData(selectedCity.latitude, selectedCity.longitude);
        if (!cancelled) setWeatherData(res.dataseries);
      } catch {
        if (!cancelled) setError('Unable to load weather data. Try again later.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedCity]);

  // Close results when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleCitySelect = useCallback((city: City) => {
    setSelectedCity(city);
    setWeatherData(null);
    setError(null);
  }, []);

  // ── Search handlers ───────────────────────────────────────────────────────
  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!value.trim() || value.length < 2) {
      setResults([]);
      setShowResults(false);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(value)}&format=json&limit=6&addressdetails=1`,
          { headers: { 'Accept-Language': 'en' } }
        );
        const data: NominatimResult[] = await res.json();
        setResults(data);
        setShowResults(true);
      } catch { /* ignore */ }
      finally { setSearching(false); }
    }, 420);
  };

  const handleResultPick = (r: NominatimResult) => {
    const alpha2 = r.address.country_code?.toUpperCase() ?? '';
    const lon    = parseFloat(r.lon);
    const city: City = {
      name:        bestName(r),
      latitude:    parseFloat(r.lat),
      longitude:   lon,
      country:     r.address.country ?? '',
      description: r.display_name,
      flag:        flagEmoji(alpha2),
      timezone:    estTimezone(lon),
      countryCode: alpha2,
    };
    handleCitySelect(city);
    setQuery('');
    setResults([]);
    setShowResults(false);
  };

  // ── Misc helpers ──────────────────────────────────────────────────────────
  const localTime = (city: City) => {
    try {
      return new Date().toLocaleTimeString('en-US', {
        timeZone: city.timezone, hour: '2-digit', minute: '2-digit', hour12: true,
      });
    } catch { return ''; }
  };

  const dailyForecast = (): WeatherData[] => {
    if (!weatherData) return [];
    const out: WeatherData[] = [];
    for (let i = 0; i < weatherData.length; i += 8) out.push(weatherData[i]);
    return out.slice(0, 7);
  };

  const today = weatherData?.[0] ?? null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Box sx={{
      display: 'flex', flexDirection: { xs: 'column', md: 'row' },
      height: '100vh', overflow: 'hidden',
      background: 'radial-gradient(ellipse at 30% 50%, #0a1628 0%, #040b18 60%, #010306 100%)',
    }}>

      {/* ═══════════════════ GLOBE PANEL ═══════════════════════════════════ */}
      <Box sx={{ width: { xs: '100%', md: '55%' }, height: { xs: '46vh', md: '100vh' }, flexShrink: 0, position: 'relative' }}>
        <Earth selectedCity={selectedCity} cities={globalCities} onCitySelect={handleCitySelect} />

        {/* Hint */}
        <Box sx={{
          position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(10px)',
          border: `1px solid ${BORDER}`, borderRadius: 99,
          px: 2.5, py: 0.7, pointerEvents: 'none', whiteSpace: 'nowrap',
        }}>
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', letterSpacing: 1.2, fontSize: '0.62rem' }}>
            DRAG · SCROLL TO ZOOM · CLICK A PIN
          </Typography>
        </Box>

        {/* Selected city label on globe */}
        {selectedCity && (
          <Box sx={{
            position: 'absolute', top: 16, left: 16,
            display: 'flex', alignItems: 'center', gap: 1,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(12px)',
            border: `1px solid rgba(255,215,64,0.3)`, borderRadius: 2,
            px: 1.5, py: 0.75, pointerEvents: 'none',
          }}>
            <Typography sx={{ fontSize: '1.1rem' }}>{selectedCity.flag}</Typography>
            <Box>
              <Typography variant="body2" sx={{ color: GOLD, fontWeight: 700, fontSize: '0.78rem', lineHeight: 1.2 }}>
                {selectedCity.name}
              </Typography>
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.62rem' }}>
                {selectedCity.latitude.toFixed(2)}° · {selectedCity.longitude.toFixed(2)}°
              </Typography>
            </Box>
          </Box>
        )}
      </Box>

      {/* ═══════════════════ WEATHER PANEL ════════════════════════════════ */}
      <Box sx={{
        width: { xs: '100%', md: '45%' }, height: { xs: '54vh', md: '100vh' },
        overflow: 'auto', background: PANEL_BG, backdropFilter: 'blur(28px)',
        borderLeft: { md: `1px solid ${BORDER}` }, borderTop: { xs: `1px solid ${BORDER}`, md: 'none' },
        display: 'flex', flexDirection: 'column',
        '&::-webkit-scrollbar': { width: 4 },
        '&::-webkit-scrollbar-thumb': { background: 'rgba(79,195,247,0.25)', borderRadius: 2 },
      }}>

        {/* ── Sticky header ──────────────────────────────────────────────── */}
        <Box sx={{
          p: { xs: 2, sm: 2.5 }, pb: 2, borderBottom: `1px solid ${BORDER}`,
          background: 'rgba(4,10,24,0.85)', position: 'sticky', top: 0, zIndex: 10,
          backdropFilter: 'blur(20px)',
        }}>
          <Typography variant="h5" sx={{
            fontWeight: 800, letterSpacing: -0.5, mb: 0.4,
            fontSize: { xs: '1.1rem', sm: '1.25rem' },
            background: `linear-gradient(90deg, ${ACCENT} 0%, #9c89ff 100%)`,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>
            World Weather
          </Typography>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.38)', letterSpacing: 0.8, fontSize: '0.65rem' }}>
              {time.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase()}
            </Typography>
            <Typography variant="caption" sx={{ color: ACCENT, fontWeight: 700, fontFamily: 'monospace', fontSize: '0.82rem' }}>
              {time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
            </Typography>
          </Box>
        </Box>

        {/* ── Search bar ─────────────────────────────────────────────────── */}
        <Box ref={searchBoxRef} sx={{ px: { xs: 2, sm: 2.5 }, pt: 2, pb: 0.5, position: 'relative' }}>
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 1,
            background: 'rgba(255,255,255,0.055)',
            border: `1px solid ${query ? 'rgba(79,195,247,0.4)' : BORDER}`,
            borderRadius: 2, px: 1.5, py: 0.85,
            transition: 'border-color 0.2s',
          }}>
            {searching
              ? <CircularProgress size={14} sx={{ color: ACCENT, flexShrink: 0 }} />
              : <Typography sx={{ fontSize: '0.9rem', opacity: 0.5, flexShrink: 0 }}>🔍</Typography>
            }
            <InputBase
              value={query}
              onChange={e => handleQueryChange(e.target.value)}
              onFocus={() => results.length > 0 && setShowResults(true)}
              placeholder="Search any city in the world…"
              fullWidth
              sx={{
                color: '#fff', fontSize: '0.82rem',
                '& input::placeholder': { color: 'rgba(255,255,255,0.3)', opacity: 1 },
              }}
            />
            {query && (
              <Typography
                onClick={() => { setQuery(''); setResults([]); setShowResults(false); }}
                sx={{ fontSize: '0.75rem', opacity: 0.4, cursor: 'pointer', flexShrink: 0, '&:hover': { opacity: 0.8 } }}
              >✕</Typography>
            )}
          </Box>

          {/* Search results dropdown */}
          {showResults && results.length > 0 && (
            <Box sx={{
              position: 'absolute', left: { xs: 16, sm: 20 }, right: { xs: 16, sm: 20 },
              top: '100%', zIndex: 100, mt: 0.5,
              background: 'rgba(8, 18, 40, 0.97)', backdropFilter: 'blur(20px)',
              border: `1px solid ${BORDER}`, borderRadius: 2,
              overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            }}>
              {results.map((r, i) => {
                const alpha2 = r.address.country_code?.toUpperCase() ?? '';
                return (
                  <Box
                    key={r.place_id}
                    onMouseDown={() => handleResultPick(r)}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 1.2,
                      px: 1.5, py: 1,
                      cursor: 'pointer',
                      borderBottom: i < results.length - 1 ? `1px solid rgba(255,255,255,0.04)` : 'none',
                      transition: 'background 0.15s',
                      '&:hover': { background: 'rgba(79,195,247,0.1)' },
                    }}
                  >
                    <Typography sx={{ fontSize: '1rem', flexShrink: 0 }}>{flagEmoji(alpha2)}</Typography>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" noWrap sx={{ color: '#fff', fontWeight: 600, fontSize: '0.78rem' }}>
                        {bestName(r)}
                      </Typography>
                      <Typography variant="caption" noWrap sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.63rem' }}>
                        {r.display_name.split(',').slice(1, 3).join(',').trim()}
                      </Typography>
                    </Box>
                  </Box>
                );
              })}
            </Box>
          )}
          {showResults && results.length === 0 && !searching && query.length > 1 && (
            <Box sx={{
              position: 'absolute', left: { xs: 16, sm: 20 }, right: { xs: 16, sm: 20 },
              top: '100%', zIndex: 100, mt: 0.5,
              background: 'rgba(8,18,40,0.97)', border: `1px solid ${BORDER}`, borderRadius: 2,
              px: 2, py: 1.5,
            }}>
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.72rem' }}>
                No results found for "{query}"
              </Typography>
            </Box>
          )}
        </Box>

        {/* ── City grid ──────────────────────────────────────────────────── */}
        <Box sx={{ px: { xs: 2, sm: 2.5 }, pt: 1.5, pb: 1 }}>
          <Typography variant="overline" sx={{ color: 'rgba(255,255,255,0.3)', letterSpacing: 2, fontSize: '0.62rem', display: 'block', mb: 1.5 }}>
            FEATURED CITIES
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 0.75 }}>
            {globalCities.map(city => {
              const active = selectedCity?.name === city.name && selectedCity?.country === city.country;
              return (
                <Box
                  key={city.name}
                  onClick={() => handleCitySelect(city)}
                  sx={{
                    display: 'flex', alignItems: 'center', gap: 1, p: 1.1,
                    borderRadius: 1.5, cursor: 'pointer', userSelect: 'none',
                    border: `1px solid ${active ? 'rgba(255,215,64,0.45)' : 'rgba(255,255,255,0.055)'}`,
                    background: active ? 'rgba(255,215,64,0.07)' : 'rgba(255,255,255,0.025)',
                    transition: 'all 0.18s ease',
                    '&:hover': {
                      background: active ? 'rgba(255,215,64,0.11)' : 'rgba(79,195,247,0.07)',
                      border: `1px solid ${active ? 'rgba(255,215,64,0.6)' : 'rgba(79,195,247,0.35)'}`,
                      transform: 'translateY(-1px)',
                    },
                    '&:active': { transform: 'translateY(0)' },
                  }}
                >
                  <Typography sx={{ fontSize: '1.05rem', lineHeight: 1, flexShrink: 0 }}>{city.flag}</Typography>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" noWrap sx={{ fontWeight: active ? 700 : 500, color: active ? GOLD : 'rgba(255,255,255,0.82)', fontSize: '0.76rem', lineHeight: 1.25 }}>
                      {city.name}
                    </Typography>
                    <Typography variant="caption" noWrap sx={{ color: 'rgba(255,255,255,0.32)', fontSize: '0.62rem' }}>
                      {city.country}
                    </Typography>
                  </Box>
                  {active && <Box sx={{ width: 6, height: 6, borderRadius: '50%', background: GOLD, flexShrink: 0, boxShadow: `0 0 8px ${GOLD}88` }} />}
                </Box>
              );
            })}
          </Box>
        </Box>

        {/* ── Selected city card ──────────────────────────────────────────── */}
        {selectedCity && (
          <Box sx={{ px: { xs: 2, sm: 2.5 }, pb: 1.5 }}>
            <Box sx={{ p: 1.75, borderRadius: 2, background: CARD_BG, border: `1px solid rgba(255,215,64,0.18)` }}>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                <Typography sx={{ fontSize: '2rem', lineHeight: 1, mt: 0.1 }}>{selectedCity.flag}</Typography>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700, color: '#fff', lineHeight: 1.15, fontSize: '0.95rem' }}>
                    {selectedCity.name}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.42)' }}>
                    {selectedCity.country}
                  </Typography>
                </Box>
                <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                  <Typography sx={{ color: ACCENT, fontFamily: 'monospace', fontWeight: 700, fontSize: '0.92rem' }}>
                    {localTime(selectedCity)}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.28)', fontSize: '0.6rem' }}>
                    {selectedCity.timezone}
                  </Typography>
                </Box>
              </Box>
              {selectedCity.description && (
                <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.7rem', lineHeight: 1.55, mt: 1 }}>
                  {selectedCity.description.length > 120
                    ? selectedCity.description.slice(0, 120) + '…'
                    : selectedCity.description}
                </Typography>
              )}
            </Box>
          </Box>
        )}

        {/* ── Loading ─────────────────────────────────────────────────────── */}
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={30} sx={{ color: ACCENT }} thickness={3} />
          </Box>
        )}

        {/* ── Error ───────────────────────────────────────────────────────── */}
        {error && !loading && (
          <Box sx={{ px: 2.5, pb: 2 }}>
            <Box sx={{ p: 1.5, borderRadius: 1.5, background: 'rgba(255,80,80,0.08)', border: '1px solid rgba(255,80,80,0.2)' }}>
              <Typography variant="body2" sx={{ color: '#ff6b6b', fontSize: '0.78rem' }}>{error}</Typography>
            </Box>
          </Box>
        )}

        {/* ── Current weather ─────────────────────────────────────────────── */}
        {today && !loading && (
          <Box sx={{ px: { xs: 2, sm: 2.5 }, pb: 1.5 }}>
            <Typography variant="overline" sx={{ color: 'rgba(255,255,255,0.3)', letterSpacing: 2, fontSize: '0.62rem', display: 'block', mb: 1.5 }}>
              CURRENT CONDITIONS
            </Typography>
            <Box sx={{
              p: 2, borderRadius: 2,
              background: 'linear-gradient(135deg, rgba(14,28,60,0.85), rgba(20,42,85,0.65))',
              border: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 2.5,
            }}>
              <Typography sx={{ fontSize: '3.2rem', lineHeight: 1, filter: 'drop-shadow(0 0 10px rgba(255,255,255,0.25))', flexShrink: 0 }}>
                {weatherIcon(today.weather)}
              </Typography>
              <Box sx={{ flex: 1 }}>
                <Typography variant="h3" sx={{ fontWeight: 900, color: '#fff', lineHeight: 1, mb: 1.25, fontSize: { xs: '2rem', sm: '2.4rem' } }}>
                  {today.temp2m}°C
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                  {[
                    { icon: '💧', label: 'Humidity',    value: String(today.rh2m) },
                    { icon: '💨', label: 'Wind',        value: `${windLabel(today.wind10m_speed)} · ${today.wind10m_direction}` },
                    { icon: '🌧️', label: 'Precip',     value: today.prec_type === 'none' ? 'None' : today.prec_type },
                  ].map(s => (
                    <Box key={s.label} sx={{ background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.075)', borderRadius: 1, px: 1, py: 0.4 }}>
                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.35)', display: 'block', fontSize: '0.58rem', mb: 0.1 }}>
                        {s.icon} {s.label}
                      </Typography>
                      <Typography variant="body2" sx={{ color: '#e8f0fe', fontWeight: 600, fontSize: '0.72rem' }}>{s.value}</Typography>
                    </Box>
                  ))}
                </Box>
              </Box>
            </Box>
          </Box>
        )}

        {/* ── 7-day forecast ──────────────────────────────────────────────── */}
        {weatherData && !loading && dailyForecast().length > 0 && (
          <Box sx={{ px: { xs: 2, sm: 2.5 }, pb: 3 }}>
            <Typography variant="overline" sx={{ color: 'rgba(255,255,255,0.3)', letterSpacing: 2, fontSize: '0.62rem', display: 'block', mb: 1.5 }}>
              7-DAY FORECAST
            </Typography>
            <Box sx={{
              display: 'flex', gap: 0.85, overflowX: 'auto', pb: 0.5,
              '&::-webkit-scrollbar': { height: 3 },
              '&::-webkit-scrollbar-thumb': { background: 'rgba(79,195,247,0.25)', borderRadius: 2 },
            }}>
              {dailyForecast().map((day, i) => (
                <Box key={i} sx={{
                  flexShrink: 0, width: 76, p: 1.25, borderRadius: 2, textAlign: 'center',
                  background: i === 0
                    ? 'linear-gradient(160deg, rgba(79,195,247,0.18), rgba(79,195,247,0.06))'
                    : CARD_BG,
                  border: `1px solid ${i === 0 ? 'rgba(79,195,247,0.35)' : BORDER}`,
                  transition: 'all 0.2s ease', cursor: 'default',
                  '&:hover': { transform: 'translateY(-3px)', border: `1px solid rgba(79,195,247,0.45)` },
                }}>
                  <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.42)', display: 'block', fontSize: '0.58rem', mb: 0.4 }}>
                    {formatDay(day.timepoint).split(',')[0].toUpperCase()}
                  </Typography>
                  <Typography sx={{ fontSize: '1.55rem', lineHeight: 1, my: 0.5 }}>{weatherIcon(day.weather)}</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 800, color: '#fff', fontSize: '0.9rem', lineHeight: 1.1 }}>{day.temp2m}°</Typography>
                  <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.32)', fontSize: '0.58rem' }}>{day.rh2m} 💧</Typography>
                </Box>
              ))}
            </Box>
          </Box>
        )}

        {/* ── Empty state ──────────────────────────────────────────────────── */}
        {!selectedCity && !loading && (
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 4, gap: 1 }}>
            <Typography sx={{ fontSize: '2.5rem' }}>🌍</Typography>
            <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.38)', textAlign: 'center', fontSize: '0.82rem' }}>
              Search any city or pick from the list
            </Typography>
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.2)', textAlign: 'center', fontSize: '0.7rem' }}>
              You can also click a city pin on the globe
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default WeatherForecast;
