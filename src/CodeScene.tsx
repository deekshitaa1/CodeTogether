
import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import type { Mesh, Group } from 'three';
import * as THREE from 'three';

type Mode = 'Resonance' | 'Orbit' | 'Pulse';

function Sculpture({
  mode,
  playing,
}: {
  mode: Mode;
  playing: boolean;
}) {
  const assembly = useRef<Group>(null);
  const core = useRef<Mesh>(null);
  const innerRing = useRef<Mesh>(null);
  const outerRing = useRef<Mesh>(null);
  const shell = useRef<Mesh>(null);

  useFrame((state, delta) => {
    const time = state.clock.elapsedTime;
    const speed = playing ? delta : 0;

    if (assembly.current) {
      assembly.current.rotation.y += speed * (
        mode === 'Orbit' ? 0.42 : 0.13
      );
      assembly.current.rotation.x = THREE.MathUtils.damp(
        assembly.current.rotation.x,
        mode === 'Pulse' ? 0.48 : 0.16,
        2,
        delta,
      );
      assembly.current.position.y = Math.sin(time * 0.55) * 0.055;
    }

    if (core.current) {
      core.current.rotation.x += speed * 0.18;
      core.current.rotation.z += speed * 0.24;

      const pulse = mode === 'Pulse'
        ? 1 + Math.sin(time * 2.2) * 0.07
        : 1 + Math.sin(time * 0.7) * 0.015;

      core.current.scale.setScalar(pulse);
    }

    if (innerRing.current) {
      innerRing.current.rotation.x += speed * 0.22;
      innerRing.current.rotation.z -= speed * 0.12;
    }

    if (outerRing.current) {
      outerRing.current.rotation.y -= speed * 0.16;
      outerRing.current.rotation.z += speed * 0.1;
    }

    if (shell.current) {
      shell.current.rotation.y -= speed * 0.1;
      shell.current.rotation.x += speed * 0.07;
    }
  });

  return (
    <group ref={assembly} rotation={[0.15, 0.1, -0.12]}>
      {/* Dark central body */}
      <mesh ref={core}>
        <icosahedronGeometry args={[0.92, 2]} />
        <meshPhysicalMaterial
          color="#111815"
          metalness={0.92}
          roughness={0.19}
          clearcoat={1}
          clearcoatRoughness={0.12}
          flatShading
        />
      </mesh>

      {/* Fine internal lattice */}
      <mesh>
        <icosahedronGeometry args={[0.95, 2]} />
        <meshBasicMaterial
          color="#a8ff50"
          wireframe
          transparent
          opacity={0.15}
        />
      </mesh>

      {/* Sculptural outer shell */}
      <mesh ref={shell} rotation={[0.4, 0.2, 0.1]}>
        <torusKnotGeometry args={[1.12, 0.035, 180, 12, 2, 5]} />
        <meshPhysicalMaterial
          color="#a9ff58"
          metalness={0.78}
          roughness={0.22}
          emissive="#31551c"
          emissiveIntensity={0.28}
        />
      </mesh>

      {/* Tilted precision rings */}
      <mesh ref={innerRing} rotation={[0.8, 0.2, 0.1]}>
        <torusGeometry args={[1.38, 0.014, 12, 180]} />
        <meshStandardMaterial
          color="#d8e6ce"
          metalness={0.95}
          roughness={0.2}
        />
      </mesh>

      <mesh ref={outerRing} rotation={[1.1, 0.1, 0.8]}>
        <torusGeometry args={[1.63, 0.009, 8, 180]} />
        <meshStandardMaterial
          color="#7d9a79"
          metalness={0.95}
          roughness={0.25}
        />
      </mesh>

      {/* Small signal nodes */}
      {[0, 1, 2, 3].map((index) => {
        const angle = (index / 4) * Math.PI * 2;
        const radius = 1.62;

        return (
          <group
            key={index}
            position={[
              Math.cos(angle) * radius,
              Math.sin(angle) * radius * 0.75,
              Math.sin(angle * 2) * 0.25,
            ]}
          >
            <mesh>
              <sphereGeometry args={[index === 0 ? 0.065 : 0.035, 20, 20]} />
              <meshStandardMaterial
                color={index === 0 ? '#c7ff70' : '#819e82'}
                emissive={index === 0 ? '#79ff30' : '#233b2b'}
                emissiveIntensity={index === 0 ? 1.4 : 0.4}
                metalness={0.4}
                roughness={0.2}
              />
            </mesh>
          </group>
        );
      })}

      {/* Inner luminous core */}
      <mesh scale={0.29}>
        <sphereGeometry args={[1, 48, 48]} />
        <meshBasicMaterial color="#c6ff83" />
      </mesh>

      <pointLight color="#b4ff64" intensity={2.2} distance={4} />
    </group>
  );
}

function ParticleField() {
  const points = useRef<THREE.Points>(null);

  const positions = new Float32Array(180 * 3);

  for (let i = 0; i < 180; i++) {
    const i3 = i * 3;
    const radius = 2.2 + Math.random() * 2.1;
    const angle = Math.random() * Math.PI * 2;

    positions[i3] = Math.cos(angle) * radius;
    positions[i3 + 1] = (Math.random() - 0.5) * 4.5;
    positions[i3 + 2] = Math.sin(angle) * radius * 0.5;
  }

  useFrame((_, delta) => {
    if (points.current) {
      points.current.rotation.y += delta * 0.012;
    }
  });

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        color="#a9d58b"
        size={0.012}
        transparent
        opacity={0.45}
        sizeAttenuation
      />
    </points>
  );
}

export default function CodeScene({
  mode = 'Resonance',
  playing = true,
}: {
  mode?: Mode;
  playing?: boolean;
}) {
  return (
    <Canvas
      camera={{ position: [0, 0, 5.8], fov: 38 }}
      dpr={[1, 1.5]}
      gl={{ alpha: true, antialias: true }}
      onCreated={({ gl }) => {
        gl.setClearColor('#000000', 0);
      }}
    >
      <ambientLight intensity={0.55} />
      <directionalLight
        position={[3, 4, 4]}
        intensity={2.2}
        color="#e6f5d9"
      />
      <pointLight
        position={[-3, 0, 2]}
        intensity={10}
        color="#7dff59"
        distance={7}
      />
      <pointLight
        position={[2, -2, -3]}
        intensity={8}
        color="#657eae"
        distance={7}
      />

      <ParticleField />
      <Sculpture mode={mode} playing={playing} />
    </Canvas>
  );
}
