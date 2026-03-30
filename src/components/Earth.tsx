import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Box } from '@mui/material';
import { City } from '../types/weather';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const worldData = require('world-atlas/countries-110m.json');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { feature: topoFeature } = require('topojson-client');

// ── ISO 3166-1 numeric IDs ────────────────────────────────────────────────────
const COUNTRY_ISO: Record<string, number> = {
  'United Kingdom': 826, 'United States': 840, 'Japan': 392,
  'Australia': 36, 'France': 250, 'United Arab Emirates': 784,
  'Singapore': 702, 'Brazil': 76, 'South Africa': 710,
  'India': 356, 'Germany': 276, 'Canada': 124,
};

const COL_DEFAULT  = 0x00ff88;
const COL_DIMMED   = 0x003d20;
const COL_SELECTED = 0xff2244;

const PIN_DEFAULT_COL  = 0x00e5ff;
const PIN_SELECTED_COL = 0xffd740;

// Zoom bounds (camera Z distance from globe centre)
const CAM_MIN = 2.6;
const CAM_MAX = 9.0;

// ── Math helpers ──────────────────────────────────────────────────────────────
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

// ── Build a map-pin group: sphere head + thin spike pointing outward ──────────
const makePinGroup = (lat: number, lon: number, color: number): THREE.Group => {
  const group  = new THREE.Group();
  const mat    = new THREE.MeshBasicMaterial({ color });

  // Spike – thin cone, base at surface, tip outward
  const spike  = new THREE.Mesh(new THREE.ConeGeometry(0.007, 0.055, 7), mat);
  spike.position.y = 0.027;
  group.add(spike);

  // Head – sphere sitting on top of spike
  const head   = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 10), mat);
  head.position.y = 0.062;
  group.add(head);

  // Place on sphere surface and orient radially outward
  const surfPos = latLonToVec3(lat, lon, 2.0);
  group.position.copy(surfPos);
  group.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    surfPos.clone().normalize()
  );

  return group;
};

// ── Build a flat ring lying tangent to the sphere surface ─────────────────────
const makeRing = (
  lat: number, lon: number, radius: number, color: number
): THREE.LineLoop => {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
  }
  const ring = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending })
  );
  const surfPos = latLonToVec3(lat, lon, 2.02);
  ring.position.copy(surfPos);
  ring.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    surfPos.clone().normalize()
  );
  return ring;
};

// ── Component ─────────────────────────────────────────────────────────────────
interface EarthProps {
  selectedCity: City | null;
  cities: City[];
  onCitySelect: (city: City) => void;
}

const Earth: React.FC<EarthProps> = ({ selectedCity, cities, onCitySelect }) => {
  const containerRef    = useRef<HTMLDivElement>(null);
  const earthRef        = useRef<THREE.Mesh | null>(null);
  const rendererRef     = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef       = useRef<THREE.PerspectiveCamera | null>(null);
  const frameRef        = useRef<number | null>(null);

  // Pin refs: head meshes for raycasting, full groups for show/hide
  const pinHeadsRef     = useRef<THREE.Mesh[]>([]);
  const pinGroupsRef    = useRef<THREE.Group[]>([]);

  // Selected-city indicator
  const selDotRef       = useRef<THREE.Mesh | null>(null);
  const selRingRef      = useRef<THREE.LineLoop | null>(null);

  // Country outlines
  const countryLinesRef = useRef<Map<number, THREE.LineLoop[]>>(new Map());
  const defaultMatRef   = useRef<THREE.LineBasicMaterial | null>(null);
  const dimmedMatRef    = useRef<THREE.LineBasicMaterial | null>(null);
  const selectedMatRef  = useRef<THREE.LineBasicMaterial | null>(null);

  // Animation / interaction state
  const autoRotate   = useRef(true);
  const isDragging   = useRef(false);
  const prevMouse    = useRef({ x: 0, y: 0 });
  const dragVelX     = useRef(0);   // inertia
  const dragVelY     = useRef(0);
  const targetRotY   = useRef(0);
  const targetCamZ   = useRef(5);
  const targetCamY   = useRef(0);
  const pulseT       = useRef(0);
  const lastTsRef    = useRef(0);   // for delta-time

  const onSelectRef  = useRef(onCitySelect);
  useEffect(() => { onSelectRef.current = onCitySelect; }, [onCitySelect]);
  const citiesRef    = useRef(cities);
  useEffect(() => { citiesRef.current = cities; }, [cities]);

  // ── City-selection side effects ───────────────────────────────────────────
  useEffect(() => {
    const defaultMat   = defaultMatRef.current;
    const dimmedMat    = dimmedMatRef.current;
    const selectedMat  = selectedMatRef.current;
    const countryLines = countryLinesRef.current;

    if (!selectedCity) {
      autoRotate.current = true;
      targetCamZ.current = 5;
      targetCamY.current = 0;

      if (selDotRef.current)  selDotRef.current.visible  = false;
      if (selRingRef.current) selRingRef.current.visible = false;

      if (defaultMat)
        countryLines.forEach(ls => ls.forEach(l => { l.material = defaultMat; }));
      return;
    }

    autoRotate.current = false;
    targetRotY.current = lonToRotY(selectedCity.longitude);
    targetCamZ.current = 3.0;
    targetCamY.current = Math.sin(selectedCity.latitude * Math.PI / 180) * 0.85;

    // Move selected-city dot + ring
    const lat = selectedCity.latitude;
    const lon = selectedCity.longitude;
    const surfPos = latLonToVec3(lat, lon, 2.025);
    const outward = surfPos.clone().normalize();
    const quat    = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), outward
    );

    if (selDotRef.current) {
      selDotRef.current.position.copy(surfPos);
      selDotRef.current.visible = true;
    }
    if (selRingRef.current) {
      selRingRef.current.position.copy(latLonToVec3(lat, lon, 2.022));
      selRingRef.current.quaternion.copy(quat);
      selRingRef.current.visible = true;
    }

    // Country colour swap
    if (defaultMat && dimmedMat && selectedMat) {
      const isoId = COUNTRY_ISO[selectedCity.country] ?? null;
      countryLines.forEach(ls => ls.forEach(l => { l.material = dimmedMat; }));
      if (isoId !== null) {
        const ls = countryLines.get(isoId);
        if (ls) ls.forEach(l => { l.material = selectedMat; });
      }
    }
  }, [selectedCity]);

  // ── One-time scene bootstrap ──────────────────────────────────────────────
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

    // Ambient light (just for atmosphere mesh)
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));

    // Stars
    const starPos = new Float32Array(7000 * 3);
    for (let i = 0; i < starPos.length; i++) starPos[i] = (Math.random() - 0.5) * 400;
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({
      color: 0xffffff, size: 0.06, transparent: true, opacity: 0.85, sizeAttenuation: true,
    })));

    // Dark globe body
    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(2, 72, 72),
      new THREE.MeshBasicMaterial({ color: 0x040d1a })
    );
    scene.add(earth);
    earthRef.current = earth;

    // Atmosphere rim
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

    // ── Country outline materials ─────────────────────────────────────────
    const defaultMat = new THREE.LineBasicMaterial({ color: COL_DEFAULT,  transparent: true, opacity: 0.72 });
    const dimmedMat  = new THREE.LineBasicMaterial({ color: COL_DIMMED,   transparent: true, opacity: 0.40 });
    const selectedMat= new THREE.LineBasicMaterial({
      color: COL_SELECTED, transparent: true, opacity: 1.0, blending: THREE.AdditiveBlending,
    });
    defaultMatRef.current  = defaultMat;
    dimmedMatRef.current   = dimmedMat;
    selectedMatRef.current = selectedMat;

    // ── Country outlines from topojson ────────────────────────────────────
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
      polygons.forEach(poly => {
        poly.forEach((ring: number[][]) => {
          if (ring.length < 2) return;
          const pts = ring.map((c: number[]) => latLonToVec3(c[1], c[0], 2.018));
          const loop = new THREE.LineLoop(
            new THREE.BufferGeometry().setFromPoints(pts),
            defaultMat
          );
          earth.add(loop);
          loops.push(loop);
        });
      });
      if (!isNaN(id)) countryMap.set(id, loops);
    });

    // ── City pins – real geometry (sphere head + cone spike) ──────────────
    const pinHeads:  THREE.Mesh[]  = [];
    const pinGroups: THREE.Group[] = [];

    citiesRef.current.forEach(city => {
      const group = makePinGroup(city.latitude, city.longitude, PIN_DEFAULT_COL);
      earth.add(group);
      pinGroups.push(group);
      // Head is the second child (index 1) – store for raycasting
      pinHeads.push(group.children[1] as THREE.Mesh);
    });
    pinHeadsRef.current  = pinHeads;
    pinGroupsRef.current = pinGroups;

    // ── Selected-city indicator: gold dot + pulsing ring ──────────────────
    const selDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.026, 12, 12),
      new THREE.MeshBasicMaterial({ color: PIN_SELECTED_COL })
    );
    selDot.visible = false;
    earth.add(selDot);
    selDotRef.current = selDot;

    // Ring placeholder (repositioned on city change)
    const selRing = makeRing(0, 0, 0.1, PIN_SELECTED_COL);
    selRing.visible = false;
    earth.add(selRing);
    selRingRef.current = selRing;

    // ── Interaction ───────────────────────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const mouse2D   = new THREE.Vector2();

    const onMouseDown = (e: MouseEvent) => {
      isDragging.current = true;
      dragVelX.current   = 0;
      dragVelY.current   = 0;
      prevMouse.current  = { x: e.clientX, y: e.clientY };
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
      isDragging.current = false;
      container.style.cursor = 'grab';
    };

    const onClick = (e: MouseEvent) => {
      // Ignore if it was a drag (velocity-based heuristic)
      if (Math.abs(dragVelX.current) > 0.008 || Math.abs(dragVelY.current) > 0.008) return;
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
      // Normalise across browsers (deltaMode 0=px, 1=lines, 2=page)
      const delta = e.deltaMode === 0 ? e.deltaY * 0.004 : e.deltaY * 0.12;
      targetCamZ.current = Math.max(CAM_MIN, Math.min(CAM_MAX, targetCamZ.current + delta));
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      isDragging.current = true;
      dragVelX.current   = 0;
      dragVelY.current   = 0;
      prevMouse.current  = { x: e.touches[0].clientX, y: e.touches[0].clientY };
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

    // ── Animation loop (delta-time normalised + drag inertia) ─────────────
    const LERP = 0.06;   // per normalised 16.67 ms frame

    const animate = (ts: number) => {
      frameRef.current = requestAnimationFrame(animate);

      // Delta-time factor: 1.0 at 60fps, scales up/down with frame rate
      const dt    = lastTsRef.current ? Math.min((ts - lastTsRef.current) / 16.667, 3) : 1;
      lastTsRef.current = ts;
      pulseT.current += 0.045 * dt;

      const e   = earthRef.current;
      const cam = cameraRef.current;
      if (!e || !cam) return;

      if (isDragging.current) {
        // Live drag – handled in onMouseMove
      } else if (autoRotate.current) {
        // Blend inertia into auto-rotation then decay
        dragVelX.current *= Math.pow(0.88, dt);
        e.rotation.y += (0.0008 + dragVelX.current) * dt;
      } else {
        // Apply drag inertia, then lerp toward target
        dragVelX.current *= Math.pow(0.88, dt);
        dragVelY.current *= Math.pow(0.88, dt);
        e.rotation.y += dragVelX.current * dt;
        e.rotation.x  = Math.max(-0.6, Math.min(0.6,
          e.rotation.x + dragVelY.current * dt));

        // Shortest-path rotation to face selected city
        let diff = targetRotY.current - e.rotation.y;
        while (diff >  Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        e.rotation.y += diff * LERP * dt;
        e.rotation.x += (0 - e.rotation.x) * LERP * dt;
      }

      // Smooth camera zoom & tilt
      cam.position.z += (targetCamZ.current - cam.position.z) * LERP * dt;
      cam.position.y += (targetCamY.current - cam.position.y) * LERP * dt;
      cam.lookAt(0, 0, 0);

      // Pulse selected ring
      if (selRingRef.current?.visible) {
        const s = 1.0 + Math.sin(pulseT.current) * 0.18;
        selRingRef.current.scale.set(s, 1, s);
        (selRingRef.current.material as THREE.LineBasicMaterial).opacity =
          0.7 + Math.sin(pulseT.current) * 0.25;
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
