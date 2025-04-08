import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Box } from '@mui/material';

const Earth: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const earthRef = useRef<THREE.Mesh | null>(null);
  const cloudsRef = useRef<THREE.Mesh | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Store the container for cleanup
    const container = containerRef.current;
    
    // Create scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    
    // Set up camera
    const camera = new THREE.PerspectiveCamera(
      45, 
      container.clientWidth / container.clientHeight, 
      0.1, 
      1000
    );
    camera.position.z = 5;
    cameraRef.current = camera;
    
    // Set up renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    
    // Add controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enableZoom = false;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;
    controlsRef.current = controls;
    
    // Add lights
    const ambientLight = new THREE.AmbientLight(0x888888);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 3, 5);
    scene.add(directionalLight);
    
    // Create Earth
    const earthGeometry = new THREE.SphereGeometry(2, 64, 64);
    
    // Load texture
    const textureLoader = new THREE.TextureLoader();
    
    // First create a basic earth (fallback)
    const basicEarthMaterial = new THREE.MeshPhongMaterial({
      color: 0x2233ff,
      shininess: 5
    });
    
    const earth = new THREE.Mesh(earthGeometry, basicEarthMaterial);
    scene.add(earth);
    earthRef.current = earth;
    
    // Try to load the textures
    Promise.all([
      new Promise<THREE.Texture>((resolve, reject) => {
        textureLoader.load(
          'textures/earth-map.jpg',
          resolve,
          undefined,
          reject
        );
      }),
      new Promise<THREE.Texture>((resolve, reject) => {
        textureLoader.load(
          'textures/earth-bump.jpg',
          resolve,
          undefined,
          reject
        );
      }),
      new Promise<THREE.Texture>((resolve, reject) => {
        textureLoader.load(
          'textures/earth-specular.jpg',
          resolve,
          undefined,
          reject
        );
      })
    ]).then(([mapTexture, bumpTexture, specTexture]) => {
      console.log('Earth textures loaded successfully');
      
      // Replace the material with textured one
      const texturedMaterial = new THREE.MeshPhongMaterial({
        map: mapTexture,
        bumpMap: bumpTexture,
        bumpScale: 0.05,
        specularMap: specTexture,
        specular: new THREE.Color(0x333333),
        shininess: 15
      });
      
      earth.material = texturedMaterial;
      
      // Also try to add clouds
      textureLoader.load(
        'textures/clouds.jpg',
        (cloudTexture) => {
          const cloudGeometry = new THREE.SphereGeometry(2.1, 64, 64);
          const cloudMaterial = new THREE.MeshPhongMaterial({
            map: cloudTexture,
            transparent: true,
            opacity: 0.4
          });
          
          const clouds = new THREE.Mesh(cloudGeometry, cloudMaterial);
          scene.add(clouds);
          cloudsRef.current = clouds;
        },
        undefined,
        (error) => console.error('Failed to load cloud texture', error)
      );
    }).catch(error => {
      console.error('Failed to load earth textures', error);
      // Keep using the basic earth if textures fail to load
    });
    
    // Add stars (simple)
    const starGeometry = new THREE.BufferGeometry();
    const starCount = 5000;
    const starPositions = new Float32Array(starCount * 3);
    
    for (let i = 0; i < starCount * 3; i += 3) {
      starPositions[i] = (Math.random() - 0.5) * 100;
      starPositions[i + 1] = (Math.random() - 0.5) * 100;
      starPositions[i + 2] = (Math.random() - 0.5) * 100;
    }
    
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    
    const starMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.1
    });
    
    const stars = new THREE.Points(starGeometry, starMaterial);
    scene.add(stars);
    
    // Animation loop
    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate);
      
      if (earthRef.current) {
        earthRef.current.rotation.y += 0.001;
      }
      
      if (cloudsRef.current) {
        cloudsRef.current.rotation.y += 0.0015;
      }
      
      controls.update();
      renderer.render(scene, camera);
    };
    
    animate();
    
    // Handle resize
    const handleResize = () => {
      if (!container || !camera || !renderer) return;
      
      const width = container.clientWidth;
      const height = container.clientHeight;
      
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      
      renderer.setSize(width, height);
    };
    
    window.addEventListener('resize', handleResize);
    
    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      
      if (controlsRef.current) {
        controlsRef.current.dispose();
      }
      
      if (rendererRef.current) {
        if (container.contains(renderer.domElement)) {
          container.removeChild(renderer.domElement);
        }
        renderer.dispose();
      }
      
      // Dispose geometries and materials
      if (earthRef.current) {
        earthRef.current.geometry.dispose();
        if (earthRef.current.material instanceof THREE.Material) {
          earthRef.current.material.dispose();
        }
      }
      
      if (cloudsRef.current) {
        cloudsRef.current.geometry.dispose();
        if (cloudsRef.current.material instanceof THREE.Material) {
          cloudsRef.current.material.dispose();
        }
      }
    };
  }, []);

  return (
    <Box
      ref={containerRef}
      sx={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 0,
        overflow: 'hidden',
      }}
    />
  );
};

export default Earth; 