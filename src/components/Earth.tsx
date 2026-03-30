import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Box } from '@mui/material';
import { City } from '../types/weather';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const worldData = require('world-atlas/countries-110m.json');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { feature: topoFeature } = require('topojson-client');

// ── Country ID lookups ────────────────────────────────────────────────────────
// By country display-name (predefined cities)
const COUNTRY_ISO_BY_NAME: Record<string, number> = {
  'United Kingdom': 826, 'United States': 840, 'Japan': 392,
  'Australia': 36,  'France': 250,  'United Arab Emirates': 784,
  'Singapore': 702, 'Brazil': 76,   'South Africa': 710,
  'India': 356,     'Germany': 276, 'Canada': 124,
};

// By ISO 3166-1 alpha-2 code (searched cities via Nominatim)
const COUNTRY_ISO_BY_ALPHA2: Record<string, number> = {
  'GB':826,'US':840,'JP':392,'AU':36, 'FR':250,'AE':784,'SG':702,'BR':76,
  'ZA':710,'IN':356,'DE':276,'CA':124,'CN':156,'RU':643,'IT':380,'ES':724,
  'MX':484,'KR':410,'ID':360,'TR':792,'SA':682,'AR':32, 'PL':616,'NL':528,
  'SE':752,'NO':578,'CH':756,'BE':56, 'AT':40, 'PT':620,'GR':300,'CZ':203,
  'HU':348,'RO':642,'UA':804,'EG':818,'NG':566,'KE':404,'ET':231,'GH':288,
  'MA':504,'DZ':12, 'TN':788,'TZ':834,'MZ':508,'ZW':716,'TH':764,'VN':704,
  'MY':458,'PH':608,'PK':586,'BD':50, 'NZ':554,'CL':152,'CO':170,'PE':604,
  'VE':862,'EC':218,'BO':68, 'UY':858,'NP':524,'LK':144,'MM':104,'MN':496,
  'KZ':398,'IR':364,'IQ':368,'SY':760,'JO':400,'IL':376,'LB':422,'KW':414,
  'QA':634,'OM':512,'YE':887,'FI':246,'DK':208,'IE':372,'SK':703,'HR':191,
  'BA':70, 'RS':688,'BG':100,'LV':428,'LT':440,'EE':233,'BY':112,'MD':498,
  'LY':434,'SO':706,'SD':729,'ML':466,'NE':562,'SN':686,'CI':384,
  'CD':180,'CM':120,'AO':24, 'ZM':894,'MW':454,'AM':51, 'GE':268,'AZ':31,
};

const COL_DEFAULT  = 0x00ff88;
const COL_SELECTED = 0xff2244;
const PIN_IDLE_COL = 0x006688;
const PIN_SEL_COL  = 0xffd740;
const CAM_MIN = 2.5;
const CAM_MAX = 9.0;

// ── Helpers ───────────────────────────────────────────────────────────────────
const latLonToVec3 = (lat: number, lon: number, r: number): THREE.Vector3 => {
  const phi   = (90 - lat)  * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
     r * Math.cos(phi),
     r * Math.sin(phi) * Math.sin(theta)
  );
};

const lonToRotY = (lon: number): number => -(lon + 90) * (Math.PI / 180);

/** Small pin: cone spike + sphere head pointing radially outward */
const makePinGroup = (lat: number, lon: number, color: number): THREE.Group => {
  const g   = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color });
  const spike = new THREE.Mesh(new THREE.ConeGeometry(0.004, 0.04, 6), mat);
  spike.position.y = 0.02;
  g.add(spike);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 8), mat);
  head.position.y = 0.046;
  g.add(head);
  const pos = latLonToVec3(lat, lon, 2.0);
  g.position.copy(pos);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pos.clone().normalize());
  return g;
};

/** Flat ring lying tangent to the sphere at a given lat/lon */
const makeRing = (lat: number, lon: number, radius: number, color: number): THREE.LineLoop => {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
  }
  const ring = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({
      color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending,
    })
  );
  const pos = latLonToVec3(lat, lon, 2.022);
  ring.position.copy(pos);
  ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pos.clone().normalize());
  return ring;
};

// ── Component ─────────────────────────────────────────────────────────────────
interface EarthProps {
  selectedCity: City | null;
  cities: City[];
  onCitySelect: (city: City) => void;
}

const Earth: React.FC<EarthProps> = ({ selectedCity, cities, onCitySelect }) => {
  const containerRef  = useRef<HTMLDivElement>(null);
  const earthRef      = useRef<THREE.Mesh | null>(null);
  const rendererRef   = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef     = useRef<THREE.PerspectiveCamera | null>(null);
  const frameRef      = useRef<number | null>(null);
  const pinGroupsRef  = useRef<THREE.Group[]>([]);
  const pinHeadsRef   = useRef<THREE.Mesh[]>([]);
  const selDotRef     = useRef<THREE.Mesh | null>(null);
  const selRingRef    = useRef<THREE.LineLoop | null>(null);

  const countryLinesRef = useRef<Map<number, THREE.LineLoop[]>>(new Map());
  const defaultMatRef   = useRef<THREE.LineBasicMaterial | null>(null);
  const selectedMatRef  = useRef<THREE.LineBasicMaterial | null>(null);
  const prevIsoRef      = useRef<number | null>(null);

  // Animation
  const autoRotate       = useRef(true);
  const isDragging       = useRef(false);
  const rotationSettled  = useRef(false);   // ← key: stops re-targeting after user drag
  const prevMouse        = useRef({ x: 0, y: 0 });
  const dragVelX         = useRef(0);
  const dragVelY         = useRef(0);
  const targetRotY       = useRef(0);
  const targetCamZ       = useRef(5);
  const targetCamY       = useRef(0);
  const pulseT           = useRef(0);
  const lastTsRef        = useRef(0);

  const onSelectRef = useRef(onCitySelect);
  useEffect(() => { onSelectRef.current = onCitySelect; }, [onCitySelect]);
  const citiesRef = useRef(cities);
  useEffect(() => { citiesRef.current = cities; }, [cities]);

  // ── City selection effect ─────────────────────────────────────────────────
  useEffect(() => {
    const defaultMat   = defaultMatRef.current;
    const selectedMat  = selectedMatRef.current;
    const countryLines = countryLinesRef.current;

    // Restore previous country outline
    if (prevIsoRef.current !== null && defaultMat) {
      const prev = countryLines.get(prevIsoRef.current);
      if (prev) prev.forEach(l => { l.material = defaultMat; });
    }

    // Restore all regular pin groups visibility
    pinGroupsRef.current.forEach(g => { g.visible = true; });

    if (!selectedCity) {
      autoRotate.current    = true;
      rotationSettled.current = true;
      targetCamZ.current    = 5;
      targetCamY.current    = 0;
      if (selDotRef.current)  selDotRef.current.visible  = false;
      if (selRingRef.current) selRingRef.current.visible = false;
      prevIsoRef.current = null;
      return;
    }

    // ── Rotation: start fresh animation to face city ──────────────────────
    autoRotate.current      = false;
    rotationSettled.current = false;    // allow the fly-to animation
    targetRotY.current      = lonToRotY(selectedCity.longitude);
    targetCamZ.current      = 3.0;
    targetCamY.current      = Math.sin(selectedCity.latitude * Math.PI / 180) * 0.85;

    // ── Move selection indicator ──────────────────────────────────────────
    const lat = selectedCity.latitude;
    const lon = selectedCity.longitude;
    if (selDotRef.current) {
      selDotRef.current.position.copy(latLonToVec3(lat, lon, 2.025));
      selDotRef.current.visible = true;
    }
    if (selRingRef.current) {
      const pos = latLonToVec3(lat, lon, 2.023);
      selRingRef.current.position.copy(pos);
      selRingRef.current.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0), pos.clone().normalize()
      );
      selRingRef.current.visible = true;
    }

    // ── Hide the predefined pin for this city (if any) ────────────────────
    const pinIdx = citiesRef.current.findIndex(
      c => c.name === selectedCity.name && c.country === selectedCity.country
    );
    if (pinIdx !== -1) pinGroupsRef.current[pinIdx].visible = false;

    // ── Country outline: only selected country turns red ──────────────────
    const isoId =
      COUNTRY_ISO_BY_NAME[selectedCity.country] ??
      (selectedCity.countryCode
        ? COUNTRY_ISO_BY_ALPHA2[selectedCity.countryCode.toUpperCase()]
        : undefined) ??
      null;

    if (isoId !== null && selectedMat) {
      const lines = countryLines.get(isoId);
      if (lines) lines.forEach(l => { l.material = selectedMat; });
    }
    prevIsoRef.current = isoId;
  }, [selectedCity]);

  // ── Scene bootstrap (runs once) ───────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      45, container.clientWidth / container.clientHeight, 0.1, 1000
    );
    camera.position.set(0, 0, 5);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0xffffff, 0.4));

    // Stars
    const sp = new Float32Array(7000 * 3);
    for (let i = 0; i < sp.length; i++) sp[i] = (Math.random() - 0.5) * 400;
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({
      color: 0xffffff, size: 0.06, transparent: true, opacity: 0.85, sizeAttenuation: true,
    })));

    // Globe body
    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(2, 72, 72),
      new THREE.MeshBasicMaterial({ color: 0x040d1a })
    );
    scene.add(earth);
    earthRef.current = earth;

    // Atmosphere
    scene.add(new THREE.Mesh(
      new THREE.SphereGeometry(2.22, 48, 48),
      new THREE.MeshLambertMaterial({ color: 0x001a55, transparent: true, opacity: 0.28, side: THREE.BackSide })
    ));
    scene.add(new THREE.Mesh(
      new THREE.SphereGeometry(2.38, 32, 32),
      new THREE.MeshBasicMaterial({
        color: 0x0011bb, transparent: true, opacity: 0.045,
        side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
      })
    ));

    // Country line materials
    const defaultMat  = new THREE.LineBasicMaterial({ color: COL_DEFAULT,  transparent: true, opacity: 0.7 });
    const selectedMat = new THREE.LineBasicMaterial({
      color: COL_SELECTED, transparent: true, opacity: 1.0, blending: THREE.AdditiveBlending,
    });
    defaultMatRef.current  = defaultMat;
    selectedMatRef.current = selectedMat;

    // Country outlines
    const geoJSON    = topoFeature(worldData, worldData.objects.countries);
    const countryMap = countryLinesRef.current;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (geoJSON.features as any[]).forEach((feat: any) => {
      const id   = feat.id !== undefined ? parseInt(String(feat.id), 10) : NaN;
      const geom = feat.geometry;
      if (!geom) return;
      const polygons: number[][][][] =
        geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
      const loops: THREE.LineLoop[] = [];
      polygons.forEach((poly: number[][][]) => {
        poly.forEach((ring: number[][]) => {
          if (ring.length < 2) return;
          const pts = ring.map((c: number[]) => latLonToVec3(c[1], c[0], 2.018));
          const loop = new THREE.LineLoop(
            new THREE.BufferGeometry().setFromPoints(pts), defaultMat
          );
          earth.add(loop);
          loops.push(loop);
        });
      });
      if (!isNaN(id)) countryMap.set(id, loops);
    });

    // City pins (small, subtle – act as click targets)
    const groups: THREE.Group[] = [];
    const heads:  THREE.Mesh[]  = [];
    citiesRef.current.forEach(city => {
      const grp = makePinGroup(city.latitude, city.longitude, PIN_IDLE_COL);
      earth.add(grp);
      groups.push(grp);
      heads.push(grp.children[1] as THREE.Mesh);
    });
    pinGroupsRef.current = groups;
    pinHeadsRef.current  = heads;

    // Selected-city dot
    const selDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.026, 12, 12),
      new THREE.MeshBasicMaterial({ color: PIN_SEL_COL })
    );
    selDot.visible = false;
    earth.add(selDot);
    selDotRef.current = selDot;

    // Selected-city pulsing ring (placeholder – repositioned on selection)
    const selRing = makeRing(0, 0, 0.1, PIN_SEL_COL);
    selRing.visible = false;
    earth.add(selRing);
    selRingRef.current = selRing;

    // ── Input handlers ────────────────────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const mouse2D   = new THREE.Vector2();

    const onMouseDown = (e: MouseEvent) => {
      isDragging.current     = true;
      rotationSettled.current = true;   // user takes control – stop fly-to animation
      dragVelX.current       = 0;
      dragVelY.current       = 0;
      prevMouse.current      = { x: e.clientX, y: e.clientY };
      container.style.cursor = 'grabbing';
    };

    const onMouseMove = (e: MouseEvent) => {
      if (isDragging.current && earthRef.current) {
        const dx = e.clientX - prevMouse.current.x;
        const dy = e.clientY - prevMouse.current.y;
        dragVelX.current = dx * 0.005;
        dragVelY.current = dy * 0.005;
        earthRef.current.rotation.y += dragVelX.current;
        earthRef.current.rotation.x  = Math.max(-0.6, Math.min(0.6,
          earthRef.current.rotation.x + dragVelY.current));
        prevMouse.current = { x: e.clientX, y: e.clientY };
        return;
      }
      const rect = container.getBoundingClientRect();
      mouse2D.x  =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
      mouse2D.y  = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse2D, camera);
      container.style.cursor =
        raycaster.intersectObjects(pinHeadsRef.current, false).length > 0
          ? 'pointer' : 'grab';
    };

    const onMouseUp = () => {
      isDragging.current     = false;
      container.style.cursor = 'grab';
    };

    const onClick = (e: MouseEvent) => {
      if (Math.abs(dragVelX.current) > 0.01 || Math.abs(dragVelY.current) > 0.01) return;
      const rect = container.getBoundingClientRect();
      mouse2D.x  =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
      mouse2D.y  = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse2D, camera);
      const hits = raycaster.intersectObjects(pinHeadsRef.current, false);
      if (hits.length > 0) {
        const idx = pinHeadsRef.current.indexOf(hits[0].object as THREE.Mesh);
        if (idx !== -1) onSelectRef.current(citiesRef.current[idx]);
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaMode === 0 ? e.deltaY * 0.004 : e.deltaY * 0.12;
      targetCamZ.current = Math.max(CAM_MIN, Math.min(CAM_MAX, targetCamZ.current + delta));
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      isDragging.current      = true;
      rotationSettled.current = true;
      dragVelX.current        = 0;
      prevMouse.current       = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!isDragging.current || e.touches.length !== 1 || !earthRef.current) return;
      const dx = e.touches[0].clientX - prevMouse.current.x;
      const dy = e.touches[0].clientY - prevMouse.current.y;
      dragVelX.current = dx * 0.005;
      dragVelY.current = dy * 0.005;
      earthRef.current.rotation.y += dragVelX.current;
      earthRef.current.rotation.x  = Math.max(-0.6, Math.min(0.6,
        earthRef.current.rotation.x + dragVelY.current));
      prevMouse.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    const onTouchEnd = () => { isDragging.current = false; };

    container.style.cursor = 'grab';
    container.addEventListener('mousedown',  onMouseDown);
    container.addEventListener('mousemove',  onMouseMove);
    container.addEventListener('mouseup',    onMouseUp);
    container.addEventListener('mouseleave', onMouseUp);
    container.addEventListener('click',      onClick);
    container.addEventListener('wheel',      onWheel, { passive: false });
    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove',  onTouchMove,  { passive: true });
    container.addEventListener('touchend',   onTouchEnd);

    // ── Animation loop ────────────────────────────────────────────────────
    const LERP = 0.055;

    const animate = (ts: number) => {
      frameRef.current = requestAnimationFrame(animate);
      const dt = lastTsRef.current ? Math.min((ts - lastTsRef.current) / 16.667, 3) : 1;
      lastTsRef.current = ts;
      pulseT.current   += 0.045 * dt;

      const e   = earthRef.current;
      const cam = cameraRef.current;
      if (!e || !cam) return;

      if (isDragging.current) {
        // live drag handled in onMouseMove
      } else if (autoRotate.current) {
        dragVelX.current *= Math.pow(0.88, dt);
        e.rotation.y += (0.0008 + dragVelX.current) * dt;
      } else {
        // Apply residual drag inertia
        dragVelX.current *= Math.pow(0.88, dt);
        dragVelY.current *= Math.pow(0.88, dt);
        e.rotation.y += dragVelX.current * dt;
        e.rotation.x  = Math.max(-0.6, Math.min(0.6,
          e.rotation.x + dragVelY.current * dt));

        // Fly-to animation — only until the user grabs the globe
        if (!rotationSettled.current) {
          let diff = targetRotY.current - e.rotation.y;
          while (diff >  Math.PI) diff -= 2 * Math.PI;
          while (diff < -Math.PI) diff += 2 * Math.PI;
          e.rotation.y += diff * LERP * dt;
          e.rotation.x += (0 - e.rotation.x) * LERP * dt;
          // Mark settled once close enough
          if (Math.abs(diff) < 0.008) rotationSettled.current = true;
        }
      }

      // Camera zoom + tilt (always smooth)
      cam.position.z += (targetCamZ.current - cam.position.z) * LERP * dt;
      cam.position.y += (targetCamY.current - cam.position.y) * LERP * dt;
      cam.lookAt(0, 0, 0);

      // Pulse selected ring
      if (selRingRef.current?.visible) {
        const s = 1.0 + Math.sin(pulseT.current) * 0.2;
        selRingRef.current.scale.set(s, 1, s);
        (selRingRef.current.material as THREE.LineBasicMaterial).opacity =
          0.65 + Math.sin(pulseT.current) * 0.3;
      }

      renderer.render(scene, cam);
    };
    animate(0);

    const onResize = () => {
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      container.removeEventListener('mousedown',  onMouseDown);
      container.removeEventListener('mousemove',  onMouseMove);
      container.removeEventListener('mouseup',    onMouseUp);
      container.removeEventListener('mouseleave', onMouseUp);
      container.removeEventListener('click',      onClick);
      container.removeEventListener('wheel',      onWheel);
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove',  onTouchMove);
      container.removeEventListener('touchend',   onTouchEnd);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Box
      ref={containerRef}
      sx={{
        width: '100%', height: '100%',
        background: 'radial-gradient(ellipse at 40% 50%, #08122a 0%, #040d1a 50%, #010308 100%)',
        userSelect: 'none', touchAction: 'none', overflow: 'hidden',
      }}
    />
  );
};

export default Earth;
