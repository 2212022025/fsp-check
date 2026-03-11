import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as CANNON from 'cannon-es';

// --- Global Variables ---
let scene, camera, renderer, world;
let playerBody, playerMesh; // physics body and visual mesh
let moveData = { forward: 0, right: 0 }; // Joystick data
let isJumping = false;
let audioListener, shootSound;
let mapModel, gunModel;

// Camera Look Variables
let euler = new THREE.Euler(0, 0, 0, 'YXZ');
let touchStartX, touchStartY;
const lookSensitivity = 0.003;

// Assets loaded tracking
let loadedAssets = 0;
const totalAssets = 3; // map, player, sound

init();

function init() {
    // 1. Setup Three.js Scene
    const container = document.getElementById('game-container');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); // Sky blue
    scene.fog = new THREE.Fog(0x87CEEB, 20, 100);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(100, 100, 50);
    dirLight.castShadow = true;
    scene.add(dirLight);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    // 2. Setup Cannon-es Physics World
    world = new CANNON.World();
    world.gravity.set(0, -20, 0); // Earth gravity modified for game feel
    
    // Physics Material for friction/bounciness
    const physicsMaterial = new CANNON.Material('standard');
    const physicsContactMaterial = new CANNON.ContactMaterial(
        physicsMaterial, physicsMaterial, { friction: 0.1, restitution: 0.0 }
    );
    world.addContactMaterial(physicsContactMaterial);

    // Create a Flat Physics Ground (So player doesn't fall through map.glb)
    const groundShape = new CANNON.Plane();
    const groundBody = new CANNON.Body({ mass: 0, material: physicsMaterial });
    groundBody.addShape(groundShape);
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(groundBody);

    // 3. Setup Player Physics (Capsule/Cylinder)
    const radius = 1;
    const height = 2;
    playerBody = new CANNON.Body({ mass: 5, material: physicsMaterial });
    const sphereShape = new CANNON.Sphere(radius);
    playerBody.addShape(sphereShape, new CANNON.Vec3(0, radius, 0));
    playerBody.addShape(sphereShape, new CANNON.Vec3(0, radius + height, 0));
    playerBody.position.set(0, 10, 0); // Spawn position above ground
    playerBody.linearDamping = 0.9; // Prevent sliding forever
    world.addBody(playerBody);

    // 4. Load Assets
    loadAssets();

    // 5. Setup Controls & Resize
    window.addEventListener('resize', onWindowResize);
}

function loadAssets() {
    const gltfLoader = new GLTFLoader();

    // Load Map
    gltfLoader.load('assets/models/map.glb', (gltf) => {
        mapModel = gltf.scene;
        scene.add(mapModel);
        checkLoadStatus();
    }, undefined, (e) => console.error("Map error", e));

    // Load Player/Gun Model
    gltfLoader.load('assets/models/player.glb', (gltf) => {
        gunModel = gltf.scene;
        // Attach gun model to camera so it moves with view
        gunModel.position.set(0.5, -0.5, -1.5); 
        gunModel.scale.set(0.5, 0.5, 0.5);
        camera.add(gunModel);
        scene.add(camera);
        checkLoadStatus();
    }, undefined, (e) => console.error("Player error", e));

    // Audio Setup
    audioListener = new THREE.AudioListener();
    camera.add(audioListener);
    shootSound = new THREE.Audio(audioListener);
    
    const audioLoader = new THREE.AudioLoader();
    audioLoader.load('assets/sound/shoot.mp3', (buffer) => {
        shootSound.setBuffer(buffer);
        shootSound.setVolume(0.5);
        checkLoadStatus();
    }, undefined, (e) => console.error("Sound error", e));
}

function checkLoadStatus() {
    loadedAssets++;
    if (loadedAssets === totalAssets) {
        document.querySelector('#start-screen p').style.display = 'none';
        const startBtn = document.getElementById('btn-start');
        startBtn.style.display = 'block';
        
        startBtn.addEventListener('click', () => {
            document.getElementById('start-screen').style.display = 'none';
            setupControls();
            
            // Request full screen
            if (document.documentElement.requestFullscreen) {
                document.documentElement.requestFullscreen();
            }
            
            animate(); // Start game loop
        });
    }
}

function setupControls() {
    // 1. Movement Joystick (NippleJS)
    const joystickOptions = {
        zone: document.getElementById('joystick-zone'),
        mode: 'static',
        position: { left: '50%', top: '50%' },
        color: 'white'
    };
    const manager = nipplejs.create(joystickOptions);
    
    manager.on('move', (evt, data) => {
        const angle = data.angle.radian;
        const force = Math.min(data.distance / 50, 1); // Normalize 0 to 1
        // Map joystick to forward/right vectors
        moveData.forward = Math.sin(angle) * force;
        moveData.right = Math.cos(angle) * force;
    });

    manager.on('end', () => {
        moveData.forward = 0;
        moveData.right = 0;
    });

    // 2. Look Around (Touch Right Screen)
    const lookZone = document.getElementById('look-zone');
    
    lookZone.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    });

    lookZone.addEventListener('touchmove', (e) => {
        const touchX = e.touches[0].clientX;
        const touchY = e.touches[0].clientY;
        
        const deltaX = touchX - touchStartX;
        const deltaY = touchY - touchStartY;

        euler.y -= deltaX * lookSensitivity; // Yaw (Left/Right)
        euler.x -= deltaY * lookSensitivity; // Pitch (Up/Down)

        // Clamp looking straight up or down
        euler.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, euler.x));
        
        camera.quaternion.setFromEuler(euler);

        touchStartX = touchX;
        touchStartY = touchY;
    });

    // 3. Jump Button
    document.getElementById('btn-jump').addEventListener('touchstart', () => {
        // Only jump if velocity Y is close to 0 (touching ground)
        if (Math.abs(playerBody.velocity.y) < 1) {
            playerBody.velocity.y = 12; // Jump force
        }
    });

    // 4. Fire Button
    document.getElementById('btn-fire').addEventListener('touchstart', shoot);
}

function shoot() {
    // Play Sound
    if (shootSound.isPlaying) shootSound.stop();
    shootSound.play();

    // Muzzle flash effect on gun
    const flash = new THREE.PointLight(0xffaa00, 5, 5);
    flash.position.set(0, 0, -2);
    camera.add(flash);
    setTimeout(() => { camera.remove(flash); }, 50);

    // Raycast for bullet physics/hit marker
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera); // Center of screen

    // Check intersection with map
    const intersects = raycaster.intersectObject(mapModel, true);

    if (intersects.length > 0) {
        const hitPoint = intersects[0].point;
        
        // Create bullet hole / spark effect
        const hitGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
        const hitMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const hitMesh = new THREE.Mesh(hitGeo, hitMat);
        hitMesh.position.copy(hitPoint);
        scene.add(hitMesh);
        
        // Remove hit marker after 2 seconds
        setTimeout(() => { scene.remove(hitMesh); }, 2000);
    }
}

function updatePhysics() {
    // Apply movement from joystick relative to camera direction
    if (moveData.forward !== 0 || moveData.right !== 0) {
        const speed = 15;
        
        // Get camera direction (ignoring up/down pitch)
        const direction = new THREE.Vector3();
        camera.getWorldDirection(direction);
        direction.y = 0;
        direction.normalize();

        // Get right vector
        const right = new THREE.Vector3();
        right.crossVectors(camera.up, direction).normalize();

        // Calculate final velocity vector
        const moveVector = new THREE.Vector3()
            .addScaledVector(direction, moveData.forward)
            .addScaledVector(right, -moveData.right);

        // Apply to physics body (keep Y velocity for gravity/falling)
        playerBody.velocity.x = moveVector.x * speed;
        playerBody.velocity.z = moveVector.z * speed;
    }
}

function animate() {
    requestAnimationFrame(animate);

    // Step Physics World
    world.step(1 / 60);
    updatePhysics();

    // Sync Camera position to Physics Body
    // +2 on Y axis puts the camera at "eye level" of the physics capsule
    camera.position.set(
        playerBody.position.x,
        playerBody.position.y + 2,
        playerBody.position.z
    );

    // Render Scene
    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}