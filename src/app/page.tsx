"use client";

import { useEffect, useRef, useState } from "react";

type ChapterState = {
  coreSpeedX: number;
  coreSpeedY: number;
  particleSpeed: number;
  gridOpacity: number;
  chaosMultiplier: number;
};

type ThreeVector3 = {
  x: number;
  y: number;
  z: number;
};

type ThreeRotation = {
  x: number;
  y: number;
};

type ThreeMaterialWithOpacity = {
  opacity: number;
};

type ThreeGridHelper = {
  position: { y: number };
  material: ThreeMaterialWithOpacity;
};

type ThreeScene = {
  fog: unknown;
  position: unknown;
  add: (...objects: unknown[]) => void;
};

type ThreeCamera = {
  aspect: number;
  position: ThreeVector3;
  updateProjectionMatrix: () => void;
  lookAt: (target: unknown) => void;
};

type ThreeRenderer = {
  domElement: Node;
  setSize: (width: number, height: number) => void;
  setPixelRatio: (value: number) => void;
  setClearColor: (color: number, alpha?: number) => void;
  render: (scene: ThreeScene, camera: ThreeCamera) => void;
  dispose: () => void;
};

type ThreeGroup = {
  rotation: ThreeRotation;
  add: (...objects: unknown[]) => void;
};

type ThreeBufferAttribute = {
  array: Float32Array;
  needsUpdate: boolean;
};

type ThreePoints = {
  rotation: { y: number };
  geometry: unknown;
};

type ThreeParticlePoints = {
  rotation: { y: number };
  geometry: {
    attributes: {
      position: ThreeBufferAttribute;
      randomOffset: ThreeBufferAttribute;
    };
  };
};

type ThreeBufferGeometry = {
  attributes: {
    position: ThreeBufferAttribute;
    randomOffset: ThreeBufferAttribute;
  };
  setAttribute: (name: string, attribute: ThreeBufferAttribute) => void;
};

type ThreeLibrary = {
  AdditiveBlending: unknown;
  Scene: new () => ThreeScene;
  FogExp2: new (color: number, density: number) => unknown;
  PerspectiveCamera: new (
    fov: number,
    aspect: number,
    near: number,
    far: number
  ) => ThreeCamera;
  WebGLRenderer: new (options: { antialias: boolean; alpha: boolean }) => ThreeRenderer;
  GridHelper: new (
    size: number,
    divisions: number,
    colorCenterLine: number,
    colorGrid: number
  ) => ThreeGridHelper;
  Group: new () => ThreeGroup;
  IcosahedronGeometry: new (radius: number, detail: number) => unknown;
  MeshBasicMaterial: new (options: {
    color: number;
    wireframe?: boolean;
    transparent?: boolean;
    opacity?: number;
  }) => unknown;
  Mesh: new (geometry: unknown, material: unknown) => unknown;
  TorusKnotGeometry: new (
    radius: number,
    tube: number,
    tubularSegments: number,
    radialSegments: number
  ) => unknown;
  PointsMaterial: new (options: {
    color?: number;
    size: number;
    transparent?: boolean;
    opacity?: number;
    blending?: unknown;
  }) => unknown;
  Points: new (geometry: unknown, material: unknown) => ThreePoints;
  BufferGeometry: new () => ThreeBufferGeometry;
  BufferAttribute: new (array: Float32Array, itemSize: number) => ThreeBufferAttribute;
};

const ThreeBackground = ({ chapter }: { chapter: number }) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const targetState = useRef<ChapterState>({
    coreSpeedX: 0.001,
    coreSpeedY: 0.002,
    particleSpeed: 0.02,
    gridOpacity: 0.3,
    chaosMultiplier: 1,
  });

  useEffect(() => {
    switch (chapter) {
      case 0:
        targetState.current = {
          coreSpeedX: 0.001,
          coreSpeedY: 0.002,
          particleSpeed: 0.01,
          gridOpacity: 0.2,
          chaosMultiplier: 0.5,
        };
        break;
      case 1:
        targetState.current = {
          coreSpeedX: 0.01,
          coreSpeedY: -0.01,
          particleSpeed: 0.08,
          gridOpacity: 0.1,
          chaosMultiplier: 3,
        };
        break;
      case 2:
        targetState.current = {
          coreSpeedX: 0.02,
          coreSpeedY: 0.02,
          particleSpeed: 0.05,
          gridOpacity: 0.5,
          chaosMultiplier: 0.2,
        };
        break;
      case 3:
        targetState.current = {
          coreSpeedX: 0.1,
          coreSpeedY: 0.15,
          particleSpeed: 0.2,
          gridOpacity: 0.8,
          chaosMultiplier: 0.1,
        };
        break;
      case 4:
        targetState.current = {
          coreSpeedX: 0.005,
          coreSpeedY: 0.005,
          particleSpeed: 0.005,
          gridOpacity: 0.4,
          chaosMultiplier: 0,
        };
        break;
      default:
        targetState.current = {
          coreSpeedX: 0.001,
          coreSpeedY: 0.002,
          particleSpeed: 0.01,
          gridOpacity: 0.2,
          chaosMultiplier: 0.5,
        };
    }
  }, [chapter]);

  useEffect(() => {
    let scene: ThreeScene | null = null;
    let camera: ThreeCamera | null = null;
    let renderer: ThreeRenderer | null = null;
    let animationId = 0;
    let mainObject: ThreeGroup | null = null;
    let particles: ThreeParticlePoints | null = null;
    let gridHelperBottom: ThreeGridHelper | null = null;
    let gridHelperTop: ThreeGridHelper | null = null;
    let mouseX = 0;
    let mouseY = 0;

    const particleCount = 1500;
    const windowHalfX = window.innerWidth / 2;
    const windowHalfY = window.innerHeight / 2;

    const onDocumentMouseMove = (event: MouseEvent) => {
      mouseX = (event.clientX - windowHalfX) * 0.01;
      mouseY = (event.clientY - windowHalfY) * 0.01;
    };

    const onWindowResize = () => {
      if (camera && renderer) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
      }
    };

    const initThreeJS = () => {
      const THREE = (window as Window & { THREE?: ThreeLibrary }).THREE;
      if (!THREE) {
        return;
      }

      scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0x0d1b2a, 0.003);

      camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        0.1,
        1000,
      );
      camera.position.z = 30;
      camera.position.y = 5;

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setClearColor(0x0d1b2a, 1);

      if (mountRef.current) {
        mountRef.current.innerHTML = "";
        mountRef.current.appendChild(renderer.domElement);
      }

      gridHelperBottom = new THREE.GridHelper(200, 100, 0x38bdf8, 0x1e3a5f);
      gridHelperBottom.position.y = -15;
      scene.add(gridHelperBottom);

      gridHelperTop = new THREE.GridHelper(200, 100, 0xfb923c, 0x1e3a5f);
      gridHelperTop.position.y = 25;
      scene.add(gridHelperTop);

      mainObject = new THREE.Group();

      const geo1 = new THREE.IcosahedronGeometry(8, 1);
      const mat1 = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        wireframe: true,
        transparent: true,
        opacity: 0.3,
      });
      const mesh1 = new THREE.Mesh(geo1, mat1);

      const geo2 = new THREE.IcosahedronGeometry(12, 2);
      const mat2 = new THREE.MeshBasicMaterial({
        color: 0x818cf8,
        wireframe: true,
        transparent: true,
        opacity: 0.15,
      });
      const mesh2 = new THREE.Mesh(geo2, mat2);

      const geo3 = new THREE.TorusKnotGeometry(6, 1.5, 100, 16);
      const mat3 = new THREE.PointsMaterial({
        color: 0xfb923c,
        size: 0.1,
      });
      const mesh3 = new THREE.Points(geo3, mat3);

      mainObject.add(mesh1);
      mainObject.add(mesh2);
      mainObject.add(mesh3);
      scene.add(mainObject);

      const particleGeo = new THREE.BufferGeometry();
      const posArray = new Float32Array(particleCount * 3);
      const randomOffsets = new Float32Array(particleCount * 3);

      for (let i = 0; i < particleCount * 3; i += 1) {
        posArray[i] = (Math.random() - 0.5) * 100;
        randomOffsets[i] = Math.random() - 0.5;
      }

      particleGeo.setAttribute("position", new THREE.BufferAttribute(posArray, 3));
      particleGeo.setAttribute(
        "randomOffset",
        new THREE.BufferAttribute(randomOffsets, 3),
      );

      const particleMat = new THREE.PointsMaterial({
        size: 0.05,
        color: 0xffffff,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
      });
      particles = new THREE.Points(particleGeo, particleMat) as ThreeParticlePoints;
      scene.add(particles);

      document.addEventListener("mousemove", onDocumentMouseMove);
      window.addEventListener("resize", onWindowResize);
      animate();
    };

    let currentCoreSpeedX = 0.001;
    let currentCoreSpeedY = 0.002;
    let currentGridOpacity = 0.3;

    const animate = () => {
      animationId = requestAnimationFrame(animate);
      const state = targetState.current;

      currentCoreSpeedX += (state.coreSpeedX - currentCoreSpeedX) * 0.05;
      currentCoreSpeedY += (state.coreSpeedY - currentCoreSpeedY) * 0.05;
      currentGridOpacity += (state.gridOpacity - currentGridOpacity) * 0.05;

      if (gridHelperBottom && gridHelperTop) {
        gridHelperBottom.material.opacity = currentGridOpacity;
        gridHelperTop.material.opacity = currentGridOpacity * 0.5;
      }

      if (mainObject) {
        mainObject.rotation.x += currentCoreSpeedX;
        mainObject.rotation.y += currentCoreSpeedY;
      }

      if (particles) {
        particles.rotation.y -= 0.0005;
        const positions = particles.geometry.attributes.position.array;
        const offsets = particles.geometry.attributes.randomOffset.array;

        for (let i = 0; i < particleCount * 3; i += 3) {
          positions[i + 1] += state.particleSpeed;
          positions[i] += offsets[i] * state.chaosMultiplier;
          positions[i + 2] += offsets[i + 2] * state.chaosMultiplier;
          if (positions[i + 1] > 50) {
            positions[i + 1] = -50;
          }
        }

        particles.geometry.attributes.position.needsUpdate = true;
      }

      if (camera && scene) {
        camera.position.x += (mouseX - camera.position.x) * 0.05;
        camera.position.y += (-mouseY - camera.position.y) * 0.05 + 0.02;
        camera.lookAt(scene.position);
      }

      if (renderer && scene && camera) {
        renderer.render(scene, camera);
      }
    };

    const maybeThree = (window as Window & { THREE?: ThreeLibrary }).THREE;
    if (!maybeThree) {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
      script.onload = () => {
        initThreeJS();
      };
      document.head.appendChild(script);
    } else {
      initThreeJS();
    }

    return () => {
      document.removeEventListener("mousemove", onDocumentMouseMove);
      window.removeEventListener("resize", onWindowResize);
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
      if (renderer) {
        renderer.dispose();
      }
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className="fixed top-0 left-0 w-full h-full z-0 pointer-events-none"
    />
  );
};

const StoryVisual = ({ chapter }: { chapter: number }) => {
  const animationSeed = chapter;

  return (
    <div className="relative w-full h-[280px] md:h-[500px] flex items-center justify-center">
      <style>{`
        @keyframes float-1 {
          0%, 100% {
            transform: translateY(0) rotate(-6deg);
          }
          50% {
            transform: translateY(-20px) rotate(2deg);
          }
        }
        @keyframes float-2 {
          0%, 100% {
            transform: translateY(0) rotate(8deg);
          }
          50% {
            transform: translateY(-25px) rotate(-4deg);
          }
        }
        @keyframes float-3 {
          0%, 100% {
            transform: translateY(0) rotate(-3deg) scale(1.1);
          }
          50% {
            transform: translateY(15px) rotate(5deg) scale(1.1);
          }
        }
        @keyframes float-4 {
          0%, 100% {
            transform: translateY(0) rotate(15deg);
          }
          50% {
            transform: translateY(30px) rotate(5deg);
          }
        }
        @keyframes float-5 {
          0%, 100% {
            transform: translateY(0) rotate(-12deg);
          }
          50% {
            transform: translateY(-15px) rotate(-20deg);
          }
        }
        @keyframes float-6 {
          0%, 100% {
            transform: translateY(0) rotate(5deg) scale(0.85);
          }
          50% {
            transform: translateY(-10px) rotate(-5deg) scale(0.85);
          }
        }

        @keyframes drop-file-1 {
          0%, 5% {
            transform: translate(-100px, -120px) scale(1.3) rotate(-15deg);
            opacity: 0;
          }
          12%, 28% {
            transform: translate(-40px, -70px) scale(1.3) rotate(-5deg);
            opacity: 1;
          }
          34% {
            transform: translate(10px, 20px) scale(0.8) rotate(0deg);
            opacity: 1;
          }
          38%, 100% {
            transform: translate(10px, 20px) scale(0.5) rotate(0deg);
            opacity: 0;
          }
        }
        @keyframes drop-file-2 {
          0%, 10% {
            transform: translate(100px, -130px) scale(1.3) rotate(15deg);
            opacity: 0;
          }
          18%, 32% {
            transform: translate(40px, -80px) scale(1.3) rotate(5deg);
            opacity: 1;
          }
          38% {
            transform: translate(-10px, 20px) scale(0.8) rotate(0deg);
            opacity: 1;
          }
          42%, 100% {
            transform: translate(-10px, 20px) scale(0.5) rotate(0deg);
            opacity: 0;
          }
        }
        @keyframes dropzone-pulse {
          0%, 34% {
            border-color: rgba(96, 165, 250, 0.5);
            background-color: rgba(30, 58, 138, 0.2);
            transform: scale(1);
          }
          38%, 45% {
            border-color: rgba(74, 222, 128, 0.8);
            background-color: rgba(74, 222, 128, 0.15);
            transform: scale(1.02);
            box-shadow: 0 0 30px rgba(74, 222, 128, 0.3);
          }
          50%, 100% {
            border-color: rgba(96, 165, 250, 0.5);
            background-color: rgba(30, 58, 138, 0.2);
            transform: scale(1);
            box-shadow: none;
          }
        }
        @keyframes dnd-progress {
          0%, 38% {
            width: 0%;
            opacity: 1;
          }
          45%, 85% {
            width: 100%;
            opacity: 1;
          }
          90%, 100% {
            width: 100%;
            opacity: 0;
          }
        }
        @keyframes dnd-terminal {
          0%, 45% {
            opacity: 1;
            filter: blur(0px);
          }
          55%, 85% {
            opacity: 0.3;
            filter: blur(6px);
          }
          90%, 100% {
            opacity: 1;
            filter: blur(0px);
          }
        }
        @keyframes dnd-table {
          0%, 50% {
            transform: translateY(30px) scale(0.95);
            opacity: 0;
            pointer-events: none;
          }
          55%, 85% {
            transform: translateY(0) scale(1);
            opacity: 1;
            pointer-events: auto;
          }
          90%, 100% {
            transform: translateY(-10px) scale(1.05);
            opacity: 0;
          }
        }

        @keyframes step3-table-appear {
          0%, 5% {
            transform: scale(0.95);
            opacity: 0;
          }
          10%, 90% {
            transform: scale(1);
            opacity: 1;
          }
          95%, 100% {
            transform: scale(1.05);
            opacity: 0;
          }
        }
        @keyframes step3-row-appear {
          0%, 10% {
            opacity: 0;
            transform: translateX(-20px);
          }
          15%, 100% {
            opacity: 1;
            transform: translateX(0);
          }
        }
        @keyframes step3-price-calc {
          0%, 25% {
            opacity: 0;
            filter: blur(4px);
          }
          35%, 100% {
            opacity: 1;
            filter: blur(0);
          }
        }
        @keyframes step3-loser-strike {
          0%, 40% {
            color: inherit;
            text-decoration: none;
            opacity: 1;
          }
          50%, 100% {
            color: #f87171;
            text-decoration: line-through;
            opacity: 0.5;
          }
        }
        @keyframes step3-winner-highlight {
          0%, 40% {
            color: inherit;
            background: transparent;
          }
          50%, 100% {
            color: #4ade80;
            background: rgba(34, 197, 94, 0.15);
          }
        }
        @keyframes step3-margin-old {
          0%, 55% {
            opacity: 1;
            transform: translateY(0);
          }
          60%, 100% {
            opacity: 0;
            transform: translateY(-10px);
          }
        }
        @keyframes step3-margin-new {
          0%, 55% {
            opacity: 0;
            transform: translateY(10px);
          }
          60%, 100% {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes s4-btn-pdf {
          0%, 8% {
            transform: scale(1);
            filter: brightness(1);
          }
          10% {
            transform: scale(0.95);
            filter: brightness(0.8);
          }
          12%, 100% {
            transform: scale(1);
            filter: brightness(1);
          }
        }
        @keyframes s4-btn-cmd {
          0%, 38% {
            transform: scale(1);
            filter: brightness(1);
          }
          40% {
            transform: scale(0.95);
            filter: brightness(0.8);
          }
          42%, 100% {
            transform: scale(1);
            filter: brightness(1);
          }
        }
        @keyframes s4-fly-pdf {
          0%, 9% {
            opacity: 0;
            transform: translate(0, 0) scale(0.5);
          }
          10% {
            opacity: 1;
            transform: translate(0, 0) scale(1);
          }
          25%, 100% {
            opacity: 0;
            transform: translate(140px, -120px) scale(0.8);
          }
        }
        @keyframes s4-fly-cmd1 {
          0%, 39% {
            opacity: 0;
            transform: translate(0, 0) scale(0.5);
          }
          40% {
            opacity: 1;
            transform: translate(0, 0) scale(1);
          }
          55%, 100% {
            opacity: 0;
            transform: translate(-150px, 90px) scale(0.8);
          }
        }
        @keyframes s4-fly-cmd2 {
          0%, 39% {
            opacity: 0;
            transform: translate(0, 0) scale(0.5);
          }
          40% {
            opacity: 1;
            transform: translate(0, 0) scale(1);
          }
          55%, 100% {
            opacity: 0;
            transform: translate(150px, 90px) scale(0.8);
          }
        }
        @keyframes s4-target-client {
          0%, 23% {
            border-color: rgba(71, 85, 105, 1);
            color: #94a3b8;
            box-shadow: none;
            background-color: rgba(30, 41, 59, 0.8);
          }
          25%, 35% {
            border-color: #4ade80;
            color: #4ade80;
            box-shadow: 0 0 20px rgba(74, 222, 128, 0.3);
            background-color: rgba(20, 83, 45, 0.8);
          }
          38%, 100% {
            border-color: rgba(71, 85, 105, 1);
            color: #94a3b8;
            box-shadow: none;
            background-color: rgba(30, 41, 59, 0.8);
          }
        }
        @keyframes s4-target-fourn {
          0%, 53% {
            border-color: rgba(71, 85, 105, 1);
            color: #94a3b8;
            box-shadow: none;
            background-color: rgba(30, 41, 59, 0.8);
          }
          55%, 65% {
            border-color: #4ade80;
            color: #4ade80;
            box-shadow: 0 0 20px rgba(74, 222, 128, 0.3);
            background-color: rgba(20, 83, 45, 0.8);
          }
          68%, 100% {
            border-color: rgba(71, 85, 105, 1);
            color: #94a3b8;
            box-shadow: none;
            background-color: rgba(30, 41, 59, 0.8);
          }
        }
        @keyframes s4-success-overlay {
          0%, 68% {
            opacity: 0;
            transform: scale(1.05);
            pointer-events: none;
            backdrop-filter: blur(0px);
          }
          70%, 95% {
            opacity: 1;
            transform: scale(1);
            pointer-events: auto;
            backdrop-filter: blur(8px);
          }
          100% {
            opacity: 0;
            transform: scale(0.95);
            pointer-events: none;
            backdrop-filter: blur(0px);
          }
        }
      `}</style>

      <div
        className={`absolute w-full h-full transition-all duration-1000 ${
          chapter === 1 ? "opacity-100 scale-100" : "opacity-0 scale-75 pointer-events-none"
        }`}
      >
        <div key={`step1-${animationSeed}`} className="w-full h-full relative">
          <div
            className="absolute top-[5%] left-[0%] z-20"
            style={{ animation: "float-1 7s ease-in-out infinite" }}
          >
            <div className="flex items-center gap-3 bg-slate-900/95 border border-slate-700 border-l-4 border-l-red-500 p-3 rounded-xl shadow-[0_10px_30px_rgba(239,68,68,0.2)] backdrop-blur-md">
              <div>
                <p className="text-white font-bold text-sm md:text-base">
                  Plan_annoté_V2.pdf
                </p>
                <p className="text-slate-400 text-xs">8.4 MB</p>
              </div>
            </div>
          </div>

          <div
            className="absolute top-[15%] right-[-5%] z-10"
            style={{ animation: "float-2 8s ease-in-out infinite 1s" }}
          >
            <div className="flex items-center gap-3 bg-slate-900/95 border border-slate-700 border-l-4 border-l-green-500 p-3 rounded-xl shadow-[0_10px_30px_rgba(34,197,94,0.2)] backdrop-blur-md">
              <div className="bg-green-500/20 p-2 rounded-lg text-green-500">
                <svg
                  className="w-6 h-6 md:w-8 md:h-8"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  ></path>
                </svg>
              </div>
              <div>
                <p className="text-white font-bold text-sm md:text-base">
                  Tarifs_Fournisseur_A.xlsx
                </p>
                <p className="text-slate-400 text-xs">2.1 MB</p>
              </div>
            </div>
          </div>

          <div
            className="absolute top-[40%] left-[10%] z-30"
            style={{ animation: "float-3 6s ease-in-out infinite 0.5s" }}
          >
            <div className="flex items-center gap-3 bg-slate-900/95 border border-slate-700 border-l-4 border-l-yellow-500 p-4 rounded-xl shadow-[0_15px_40px_rgba(234,179,8,0.3)] backdrop-blur-xl">
              <div className="bg-yellow-500/20 p-2 rounded-lg text-yellow-500">
                <svg
                  className="w-8 h-8 md:w-10 md:h-10"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M4 6h16M4 10h16M4 14h16M4 18h16"
                  ></path>
                </svg>
              </div>
              <div>
                <p className="text-white font-extrabold text-base md:text-lg">
                  DPGF_brut_3000L.csv
                </p>
                <p className="text-yellow-400 text-xs font-mono">
                  3,042 Lignes • 44 Colonnes
                </p>
              </div>
            </div>
          </div>

          <div
            className="absolute bottom-[10%] right-[0%] z-20"
            style={{ animation: "float-4 9s ease-in-out infinite 2s" }}
          >
            <div className="flex items-center gap-3 bg-slate-900/95 border border-slate-700 border-l-4 border-l-red-500 p-3 rounded-xl shadow-[0_10px_30px_rgba(239,68,68,0.2)] backdrop-blur-md">
              <div className="bg-red-500/20 p-2 rounded-lg text-red-500">
                <svg
                  className="w-5 h-5 md:w-6 md:h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                  ></path>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M9 14h6m-6 4h6"
                  ></path>
                </svg>
              </div>
              <div>
                <p className="text-white font-bold text-sm">CCTP_Plomberie.pdf</p>
                <p className="text-slate-400 text-xs">45 Pages</p>
              </div>
            </div>
          </div>

          <div
            className="absolute bottom-[15%] left-[-10%] z-10"
            style={{ animation: "float-5 7.5s ease-in-out infinite 1.5s" }}
          >
            <div className="flex items-center gap-3 bg-slate-900/95 border border-slate-700 border-l-4 border-l-blue-500 p-3 rounded-xl shadow-[0_10px_30px_rgba(59,130,246,0.2)] backdrop-blur-md">
              <div className="bg-blue-500/20 p-2 rounded-lg text-blue-500">
                <svg
                  className="w-5 h-5 md:w-6 md:h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  ></path>
                </svg>
              </div>
              <div>
                <p className="text-white font-bold text-sm">
                  Notes_chantier.jpg
                </p>
                <p className="text-slate-400 text-xs">Photo illisible</p>
              </div>
            </div>

            <div
              className="absolute top-[35%] right-[20%] z-0 opacity-60"
              style={{ animation: "float-6 10s ease-in-out infinite 0.2s" }}
            >
              <div className="flex items-center gap-3 bg-slate-900/95 border border-slate-700 border-l-4 border-l-green-600 p-3 rounded-xl">
                <div className="bg-green-600/20 p-2 rounded-lg text-green-600">
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    ></path>
                  </svg>
                </div>
                <div>
                  <p className="text-white font-bold text-sm">
                    Ancien_devis_V3.xls
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        className={`absolute w-full max-w-lg transition-all duration-1000 ${
          chapter === 2
            ? "opacity-100 translate-x-0"
            : "opacity-0 translate-x-10 pointer-events-none"
        }`}
      >
        <div
          key={`step2-${animationSeed}`}
          className="relative w-full h-[350px] flex flex-col items-center justify-center mt-10"
        >
          <div
            className="w-full h-32 border-2 border-dashed border-blue-400/50 rounded-xl bg-blue-900/20 backdrop-blur-md flex flex-col items-center justify-center relative overflow-hidden shadow-[0_0_30px_rgba(56,189,248,0.1)] z-10 transition-colors"
            style={{ animation: "dropzone-pulse 12s ease-in-out infinite" }}
          >
            <svg
              className="w-8 h-8 text-blue-400 mb-2 opacity-70"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              ></path>
            </svg>
            <span className="text-blue-300 font-semibold text-sm">
              Glissez-déposez vos fichiers ici
            </span>
            <div
              className="absolute bottom-0 left-0 h-1.5 bg-green-400 shadow-[0_0_15px_#4ade80]"
              style={{ animation: "dnd-progress 12s ease-in-out infinite" }}
            ></div>
          </div>

          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full pointer-events-none z-30">
            <div
              className="absolute top-0 left-[15%] bg-yellow-400 text-slate-900 px-5 py-3 rounded-xl shadow-[0_15px_40px_rgba(250,204,21,0.5)] flex items-center gap-3 font-extrabold text-sm md:text-base border-2 border-yellow-200"
              style={{ animation: "drop-file-1 12s cubic-bezier(0.4, 0, 0.2, 1) infinite" }}
            >
              <svg
                className="w-6 h-6 md:w-8 md:h-8"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 6h16M4 10h16M4 14h16M4 18h16"
                ></path>
              </svg>{" "}
              DPGF_brut.csv
            </div>
            <div
              className="absolute top-0 left-[55%] bg-green-400 text-slate-900 px-5 py-3 rounded-xl shadow-[0_15px_40px_rgba(74,222,128,0.5)] flex items-center gap-3 font-extrabold text-sm md:text-base border-2 border-green-200"
              style={{ animation: "drop-file-2 12s cubic-bezier(0.4, 0, 0.2, 1) infinite" }}
            >
              <svg
                className="w-6 h-6 md:w-8 md:h-8"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                ></path>
              </svg>{" "}
              Tarifs.xlsx
            </div>
          </div>

          <div
            className="w-11/12 bg-slate-900/90 border border-slate-700 rounded-b-xl overflow-hidden shadow-2xl backdrop-blur-xl -mt-2 z-0"
            style={{ animation: "dnd-terminal 12s ease-in-out infinite" }}
          >
            <div className="p-4 font-mono text-xs md:text-sm text-green-400 h-28 flex flex-col justify-start space-y-1">
              <p className="opacity-70">&gt; Parsing document structure...</p>
              <p className="opacity-90">&gt; Entity extraction &amp; cleaning [OK]</p>
              <p className="text-blue-400 font-bold">&gt; 3,042 items recognized</p>
              <p className="animate-pulse">
                &gt; Rendering structured matrix <span className="text-white">_</span>
              </p>
            </div>
          </div>

          <div
            className="absolute top-10 w-[105%] z-20"
            style={{ animation: "dnd-table 12s ease-out infinite" }}
          >
            <div className="bg-[#0d1b2a]/95 border border-green-500/50 rounded-xl shadow-[0_20px_50px_rgba(34,197,94,0.25)] overflow-hidden backdrop-blur-2xl">
              <div className="bg-gradient-to-r from-green-500/20 to-transparent text-green-400 text-xs font-bold px-4 py-3 border-b border-green-500/30 flex justify-between items-center">
                <span className="flex items-center gap-2">
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M5 13l4 4L19 7"
                    ></path>
                  </svg>
                  DONNÉES STRUCTURÉES PAR TIMAX
                </span>
                <span className="bg-green-500/20 text-green-300 px-2 py-1 rounded">
                  3,042 LIGNES PRÊTES
                </span>
              </div>
              <table className="w-full text-left text-xs md:text-sm">
                <thead className="bg-slate-800/80 text-slate-300">
                  <tr>
                    <th className="p-3">Réf</th>
                    <th className="p-3">Désignation</th>
                    <th className="p-3 text-right">Qté</th>
                  </tr>
                </thead>
                <tbody className="text-slate-200 font-mono">
                  <tr className="border-b border-slate-700/50">
                    <td className="p-3 text-cyan-400">CBL-CU-25</td>
                    <td className="p-3 truncate max-w-[150px] md:max-w-none">
                      Câble Cuivre 25mm nu
                    </td>
                    <td className="p-3 text-right">150 m</td>
                  </tr>
                  <tr className="border-b border-slate-700/50">
                    <td className="p-3 text-cyan-400">PVC-TU-100</td>
                    <td className="p-3 truncate max-w-[150px] md:max-w-none">
                      Tube PVC Pression 100mm
                    </td>
                    <td className="p-3 text-right">45 U</td>
                  </tr>
                  <tr>
                    <td className="p-3 text-cyan-400">VLV-PAP-50</td>
                    <td className="p-3 truncate max-w-[150px] md:max-w-none">
                      Vanne papillon DN50 Fonte
                    </td>
                    <td className="p-3 text-right">12 U</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div
        className={`absolute w-full max-w-[550px] transition-all duration-1000 ${
          chapter === 3
            ? "opacity-100 scale-100"
            : "opacity-0 scale-110 pointer-events-none"
        }`}
      >
        <div
          key={`step3-${animationSeed}`}
          className="w-full"
        >
          <div style={{ animation: "step3-table-appear 10s infinite" }}>
            <div className="flex items-center gap-2 text-cyan-400 text-[10px] md:text-xs font-mono bg-cyan-900/30 px-3 py-1.5 rounded-full border border-cyan-500/30">
              <span
                className="w-2 h-2 rounded-full bg-cyan-400"
                style={{ animation: "step3-price-calc 10s infinite" }}
              ></span>
              LIVE API: FOURNISSEURS SYNC
            </div>

            <div className="relative bg-slate-900/80 backdrop-blur-md rounded-xl px-4 py-2 border border-slate-600 shadow-xl flex items-center gap-3">
              <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
                Marge Nette
              </span>
              <div className="relative w-16 h-6 font-black text-lg">
                <span className="absolute inset-0 flex items-center justify-end text-white" style={{ animation: "step3-margin-old 10s infinite" }}>
                  24.5%
                </span>
                <span className="absolute inset-0 flex items-center justify-end text-green-400" style={{ animation: "step3-margin-new 10s infinite" }}>
                  32.4%
                  <svg
                    className="w-4 h-4 ml-1"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                    ></path>
                  </svg>
                </span>
              </div>
            </div>
          </div>

          <div className="bg-[#0d1b2a]/90 border border-slate-700/80 rounded-2xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-2xl p-1 relative">
            <table className="w-full text-left text-xs md:text-sm">
              <thead className="bg-slate-800/80 text-slate-300">
                <tr>
                  <th className="p-3 md:p-4 rounded-tl-xl">Référence</th>
                  <th className="p-3 md:p-4">Fournisseur A</th>
                  <th className="p-3 md:p-4">Fournisseur B</th>
                  <th className="p-3 md:p-4 rounded-tr-xl bg-blue-900/20 text-blue-300 border-l border-blue-500/20">
                    Décision TIMAX
                  </th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
                <tr
                  className="border-b border-slate-700/50"
                  style={{ animation: "step3-row-appear 10s infinite" }}
                >
                  <td className="p-3 md:p-4 font-mono text-cyan-400">CBL-CU-25</td>
                  <td className="p-3 md:p-4" style={{ animation: "step3-loser-strike 10s infinite" }}>
                    12.40 €
                  </td>
                  <td className="p-3 md:p-4" style={{ animation: "step3-price-calc 10s infinite" }}>
                    11.90 €
                  </td>
                  <td className="p-2 md:p-3 border-l border-blue-500/20">
                    <div className="font-bold px-2 py-1 inline-block" style={{ animation: "step3-winner-highlight 10s infinite" }}>
                      Fourn. B (-4%)
                    </div>
                  </td>
                </tr>

                <tr
                  className="border-b border-slate-700/50"
                  style={{ animation: "step3-row-appear 10s infinite 1.5s backwards" }}
                >
                  <td className="p-3 md:p-4 font-mono text-cyan-400">PVC-TU-100</td>
                  <td className="p-3 md:p-4" style={{ animation: "step3-price-calc 10s infinite 1.5s backwards" }}>
                    4.50 €
                  </td>
                  <td className="p-3 md:p-4" style={{ animation: "step3-loser-strike 10s infinite 1.5s backwards" }}>
                    5.10 €
                  </td>
                  <td className="p-2 md:p-3 border-l border-blue-500/20">
                    <div className="font-bold px-2 py-1 inline-block" style={{ animation: "step3-winner-highlight 10s infinite 1.5s backwards" }}>
                      Fourn. A (-11%)
                    </div>
                  </td>
                </tr>

                <tr style={{ animation: "step3-row-appear 10s infinite 3s backwards" }}>
                  <td className="p-3 md:p-4 font-mono text-cyan-400">POM-HYD-X</td>
                  <td className="p-3 md:p-4" style={{ animation: "step3-loser-strike 10s infinite 3s backwards" }}>
                    450.00 €
                  </td>
                  <td className="p-3 md:p-4" style={{ animation: "step3-loser-strike 10s infinite 3s backwards" }}>
                    465.00 €
                  </td>
                  <td className="p-2 md:p-3 border-l border-blue-500/20">
                    <div className="font-bold px-2 py-1 inline-block text-cyan-400 bg-cyan-500/10 rounded border border-cyan-500/30" style={{ animation: "step3-price-calc 10s infinite 3s backwards" }}>
                      Stock (0.00 €)
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div
        className={`absolute w-full max-w-md transition-all duration-1000 ${
          chapter === 4
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-10 pointer-events-none"
        }`}
      >
        <div
          key={`step4-${animationSeed}`}
          className="relative w-full pb-10 md:pb-0"
        >
          <div
            className="absolute top-2 right-2 md:-top-12 md:-right-10 flex items-center gap-2 border px-3 py-1.5 md:px-4 md:py-2 rounded-full shadow-lg z-20 transition-colors duration-300 text-xs md:text-sm"
            style={{ animation: "s4-target-client 12s infinite" }}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-current shadow-[0_0_10px_currentColor]"></span>
            <span className="text-sm font-bold tracking-wide">Client</span>
          </div>
          <div
            className="absolute -bottom-6 left-0 md:-bottom-14 md:-left-12 flex items-center gap-2 border px-3 py-1.5 md:px-4 md:py-2 rounded-full shadow-lg z-0 transition-colors duration-300 text-xs md:text-sm"
            style={{ animation: "s4-target-fourn 12s infinite" }}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-current shadow-[0_0_10px_currentColor]"></span>
            <span className="text-sm font-bold tracking-wide">Fourn. A</span>
          </div>
          <div
            className="absolute -bottom-6 right-0 md:-bottom-14 md:-right-12 flex items-center gap-2 border px-3 py-1.5 md:px-4 md:py-2 rounded-full shadow-lg z-0 transition-colors duration-300 text-xs md:text-sm"
            style={{ animation: "s4-target-fourn 12s infinite" }}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-current shadow-[0_0_10px_currentColor]"></span>
            <span className="text-sm font-bold tracking-wide">Fourn. B</span>
          </div>

          <div
            className="absolute top-[60%] left-[20%] z-30 pointer-events-none"
            style={{ animation: "s4-fly-pdf 12s infinite" }}
          >
            <div className="bg-red-500 text-white p-2 rounded shadow-[0_0_20px_rgba(239,68,68,0.5)] flex items-center gap-1">
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                ></path>
              </svg>
              <span className="text-xs font-bold">Devis.pdf</span>
            </div>
          </div>
          <div
            className="absolute top-[60%] left-[50%] z-30 pointer-events-none"
            style={{ animation: "s4-fly-cmd1 12s infinite" }}
          >
            <div className="bg-blue-500 text-white p-2 rounded shadow-[0_0_20px_rgba(59,130,246,0.5)] flex items-center gap-1">
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                ></path>
              </svg>
              <span className="text-xs font-bold">Bon de Cmd</span>
            </div>
          </div>
          <div
            className="absolute top-[60%] left-[50%] z-30 pointer-events-none"
            style={{ animation: "s4-fly-cmd2 12s infinite" }}
          >
            <div className="bg-blue-500 text-white p-2 rounded shadow-[0_0_20px_rgba(59,130,246,0.5)] flex items-center gap-1">
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                ></path>
              </svg>
              <span className="text-xs font-bold">Bon de Cmd</span>
            </div>
          </div>

          <div className="relative bg-[#0d1b2a]/90 border border-slate-600 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.6)] backdrop-blur-xl p-8 text-center z-10 overflow-hidden">
            <div className="w-16 h-16 bg-green-500/20 text-green-400 rounded-full flex items-center justify-center mx-auto mb-4 border border-green-500/50">
              <svg
                className="w-8 h-8"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M5 13l4 4L19 7"
                ></path>
              </svg>
            </div>
            <h3 className="text-2xl font-bold text-white mb-2">Chiffrage Validé</h3>
            <p className="text-slate-400 text-sm mb-6">Prêt pour l&apos;exécution automatique</p>

            <div className="flex justify-center gap-4 mb-8">
              <div className="bg-slate-800/80 px-4 py-3 rounded-lg border border-slate-700 w-1/2">
                <span className="block text-xs text-slate-400 mb-1 uppercase tracking-wider">
                  Total Projet
                </span>
                <span className="font-bold text-blue-400 text-xl">142,500 €</span>
              </div>
              <div className="bg-slate-800/80 px-4 py-3 rounded-lg border border-slate-700 w-1/2">
                <span className="block text-xs text-slate-400 mb-1 uppercase tracking-wider">
                  Marge Nette
                </span>
                <span className="font-bold text-green-400 text-xl">32.4 %</span>
              </div>
            </div>

            <div className="flex gap-4 relative">
              <button
                className="flex-1 bg-blue-600 border border-blue-500 text-white py-3 rounded-xl text-sm font-bold shadow-[0_0_15px_rgba(37,99,235,0.3)] transition-transform"
                style={{ animation: "s4-btn-pdf 12s infinite" }}
              >
                1. Export PDF
              </button>
              <button
                className="flex-1 bg-slate-700 border border-slate-600 text-white py-3 rounded-xl text-sm font-bold shadow-lg transition-transform"
                style={{ animation: "s4-btn-cmd 12s infinite" }}
              >
                2. Créer Commandes
              </button>
            </div>

            <div
              className="absolute inset-0 bg-green-900/90 flex flex-col items-center justify-center z-20"
              style={{ animation: "s4-success-overlay 12s infinite" }}
            >
              <div className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center mb-4 shadow-[0_0_50px_rgba(74,222,128,0.8)]">
                <svg
                  className="w-10 h-10 text-slate-900"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="3"
                    d="M5 13l4 4L19 7"
                  ></path>
                </svg>
              </div>
              <h3 className="text-3xl font-extrabold text-white mb-2 tracking-tight">
                Flux Terminé
              </h3>
              <p className="text-green-200 font-medium text-lg">Temps gagné : 3 jours</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const storyData = [
  {
    title: "Lundi matin, le chaos habituel.",
    text: "8h00. Votre client vous envoie un DPGF de 3\u00a0000 lignes en PDF, quatre grilles tarifaires fournisseurs en Excel et un plan annoté à la main. Classiquement, il faut trois jours pour tout ressaisir, croiser et chiffrer. Trois jours de copier-coller et de risques d\u2019erreurs.",
  },
  {
    title: "L\u2019import intelligent.",
    text: "Glissez-déposez vos fichiers dans TIMAX. L\u2019algorithme parse le DPGF, identifie chaque ligne article, nettoie les désignations et structure le tout en matrice exploitable. Les ouvrages techniques métier sont reconnus automatiquement \u2014 pas de ressaisie.",
  },
  {
    title: "Le chiffrage au meilleur prix.",
    text: "TIMAX se connecte à vos tarifs négociés et compare chaque référence entre vos fournisseurs. Le moteur arbitre ligne par ligne\u00a0: le cuivre chez A, le PVC chez B, la robinetterie en stock. Résultat\u00a0: une marge optimisée sans aucun calcul manuel.",
  },
  {
    title: "Le chiffrage bouclé avant midi.",
    text: "11h30, même matinée. Le chiffrage est bouclé \u2014 chaque ligne vérifiée, chaque marge sécurisée, zéro erreur de nomenclature. Il ne reste qu\u2019à exporter\u00a0: le devis PDF part au client, les bons de commande fournisseurs sont prêts. Trois jours de travail compressés en quelques heures.",
  },
];

const App = () => {
  const [scrolled, setScrolled] = useState(false);
  const [activeChapter, setActiveChapter] = useState(0);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const chapterIndex = parseInt(entry.target.id.split("-")[1], 10);
            setActiveChapter(chapterIndex);
          }
        });
      },
      {
        threshold: 0.5,
        rootMargin: "-10% 0px -10% 0px",
      },
    );

    const chapters = document.querySelectorAll(".story-chapter");
    chapters.forEach((chap) => observer.observe(chap));

    return () => {
      chapters.forEach((chap) => observer.unobserve(chap));
    };
  }, []);

  return (
    <div className="relative min-h-screen bg-[#0d1b2a] font-sans text-slate-100 selection:bg-orange-500 selection:text-white overflow-x-clip">
      <ThreeBackground chapter={activeChapter} />

      <div className="fixed inset-0 bg-[#0d1b2a]/15 pointer-events-none z-0"></div>
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-transparent via-transparent to-[#0d1b2a]/70 pointer-events-none z-0"></div>

      <nav
        className={`fixed w-full z-50 transition-all duration-300 ${
          scrolled
            ? "bg-[#0d1b2a]/95 backdrop-blur-xl shadow-lg py-4 border-b border-white/5"
            : "bg-transparent py-4 md:py-6"
        }`}
      >
        <div className="max-w-7xl mx-auto px-6 flex justify-between items-center">
          <div className="bg-white rounded-full inline-flex items-center px-4 py-1.5 shadow-[0_0_15px_rgba(56,189,248,0.3)]">
            <span className="text-blue-900 font-extrabold text-xl tracking-tight">
              Hydro
            </span>
            <span className="text-orange-600 font-bold text-base ml-1">express</span>
          </div>
          <div className="hidden md:flex space-x-8 text-sm font-medium">
            <a href="#story" className="hover:text-orange-400 transition-colors">
              Le flux
            </a>
            <a href="#dashboard" className="hover:text-orange-400 transition-colors">
              Réserver une démo
            </a>
          </div>
          <div className="flex gap-2 md:gap-4">
            <a
              href="/login"
              className="inline-flex px-3 md:px-5 py-2 text-xs md:text-sm font-bold rounded-lg bg-white/10 border border-white/20 text-white hover:bg-white/20 transition-all"
            >
              Connexion
            </a>
            <a
              href="/signup"
              className="inline-flex px-3 md:px-5 py-2 text-xs md:text-sm font-bold rounded-lg border border-orange-300/60 text-orange-200 hover:bg-orange-300/10 transition-all"
            >
              S&apos;inscrire
            </a>
          </div>
        </div>
      </nav>

      <main className="relative z-10">
        <section
          id="chapter-0"
          className="story-chapter min-h-screen flex flex-col justify-center items-center text-center px-6 pt-20 relative"
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] md:w-[60%] h-[70%] bg-[#0d1b2a]/60 blur-[100px] rounded-full pointer-events-none z-[-1]"></div>

          <h1 className="text-5xl md:text-7xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white via-blue-50 to-slate-300 mb-6 max-w-5xl leading-tight drop-shadow-md">
            Vos devis <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">chiffrés en heures</span>, pas en jours.
          </h1>

          <p className="text-lg md:text-2xl text-slate-200 mb-10 max-w-3xl font-medium drop-shadow-md">
            TIMAX importe vos DPGF, structure chaque ligne, compare vos fournisseurs et optimise vos marges. Le chiffrage qui prenait 3 jours se boucle en une matinée.
          </p>

          <div className="animate-bounce mt-10 opacity-50">
            <p className="text-sm mb-2 uppercase tracking-widest text-blue-300">
              Voir comment ça marche
            </p>
            <svg
              className="w-6 h-6 mx-auto text-blue-300"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M19 14l-7 7m0 0l-7-7m7 7V3"
              ></path>
            </svg>
          </div>
        </section>

        <section id="story" className="relative max-w-7xl mx-auto px-6">
          <div className="hidden md:flex absolute right-0 top-0 w-1/2 h-full z-20">
            <div className="sticky top-0 w-full h-screen flex items-center justify-center p-10">
              <StoryVisual chapter={activeChapter} />
            </div>
          </div>

          <div className="w-full md:w-1/2 relative z-10 py-16 md:py-32">
            {storyData.map((step, index) => {
              const chapNum = index + 1;
              const isActive = activeChapter === chapNum;

              return (
                <div
                  key={chapNum}
                  id={`chapter-${chapNum}`}
                  className={`story-chapter min-h-screen md:min-h-[130vh] flex flex-col justify-center transition-opacity duration-700 ${
                    isActive ? "opacity-100" : "opacity-20"
                  }`}
                >
                  <div className="bg-[#0d1b2a]/80 backdrop-blur-md border border-slate-700/50 p-5 md:p-10 rounded-3xl shadow-2xl">
                    <div className="flex items-baseline gap-3 mb-3 md:mb-6">
                      <span className="text-orange-500 font-mono font-bold text-2xl md:text-xl shrink-0">0{chapNum}</span>
                      <h2 className="text-2xl md:text-4xl font-bold text-white leading-tight drop-shadow-md">
                        {step.title}
                      </h2>
                    </div>
                    <p className="text-base md:text-lg text-slate-300 leading-normal md:leading-relaxed font-medium">
                      {step.text}
                    </p>
                  </div>

                  <div className={`md:hidden ${chapNum === 2 || chapNum === 4 ? "mt-22" : "mt-4"}`}>
                    <StoryVisual chapter={isActive ? chapNum : 0} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <footer
          id="dashboard"
          className="py-24 text-center border-t border-slate-700 bg-[#0d1b2a]/95 backdrop-blur-2xl relative z-10"
        >
          <h2 className="text-4xl font-bold mb-6 text-white drop-shadow-sm">
            Prêt à chiffrer 4 fois plus vite ?
          </h2>
          <p className="text-slate-300 mb-10 max-w-xl mx-auto text-lg">
            Bureaux d&apos;études, entreprises générales, corps d&apos;état techniques — rejoignez ceux qui ont automatisé leur chiffrage avec TIMAX.
          </p>
          <button className="px-10 py-5 text-xl font-bold rounded-xl bg-orange-500 hover:bg-orange-400 text-white shadow-[0_0_30px_rgba(251,146,60,0.5)] transition-all transform hover:scale-105">
            Réserver une démo gratuite
          </button>
        </footer>
      </main>
    </div>
  );
};

export default App;
