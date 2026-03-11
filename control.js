import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as CANNON from 'cannon-es';

// --- GAME SETTINGS ---
const WALK_SPEED = 12;
const JUMP_FORCE = 12;
const LOOK_SENSITIVITY = 0.004;

// --- TWEAK YOUR GUN POSITION HERE ---
// If your gun looks weird, change these numbers!
const GUN_SCALE = 0.5; // Make model bigger/smaller
const GUN_POS_X = 0.4; // Move Right/Left
const GUN_POS_Y = -0.4; // Move Up/Down
const GUN_POS_Z = -1.0; // Move Forward/Back

// Global Variables
let scene, camera, renderer, world;
let playerBody, gunModel, mapModel;
let moveData = { x: 0, y: 0 }; 
let isJumping = false;
let audioListener, shootSound;
let euler = new THREE.Euler(0, 0, 0, 'YXZ');

let loadedAssets = 0;
const totalAssets = 3; 

init();

function init() {
    // 1. Setup Three.js Scene
    const container = document.getElementById('game-container');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); 
    scene.fog = new THREE.Fog(0x87CEEB, 20, 150);

    // 2. Setup Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

    // 3. Setup Renderer (FIXED FOR EXACT MAP COLORS)
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // THESE TWO LINES MAKE GLTF MODELS LOOK EXACTLY LIKE BLENDER:
    renderer.outputColorSpace = THREE.SRGBColorSpace; 
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(renderer.domElement);

    // 4. Setup Lighting (Better visibility)
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    hemiLight.position.set(0, 200, 0);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(50, 100, 50);
    dirLight.castShadow = true;
    dirLight.shadow.camera.top = 50;
    dirLight.shadow.camera.bottom = -50;
    dirLight.shadow.camera.left = -50;
    dirLight.shadow.camera.right = 50;
    scene.add(dirLight);

    // 5. Setup Physics World
    world = new CANNON.World();
    world.gravity.set(0, -30, 0); // Snappy gravity
    
    const physicsMaterial = new CANNON.Material('standard');
    const physicsContactMaterial = new CANNON.ContactMaterial(
        physicsMaterial, physicsMaterial, { friction: 0.0, restitution: 0.0 }
    );
    world.addContactMaterial(physicsContactMaterial);

    // Invisible Physics Floor
    const groundShape = new CANNON.Plane();
    const groundBody = new CANNON.Body({ mass: 0, material: physicsMaterial });
    groundBody.addShape(groundShape);
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(groundBody);

    // 6. Setup Player Physics Capsule
    const radius = 1;
    const height = 2;
    playerBody = new CANNON.Body({ mass: 5, material: physicsMaterial, fixedRotation: true });
    const sphereShape = new CANNON.Sphere(radius);
    playerBody.addShape(sphereShape, new CANNON.Vec3(0, radius, 0));
    playerBody.addShape(sphereShape, new CANNON.Vec3(0, radius + height, 0));
    playerBody.position.set(0, 5, 0); // Drop player from sky
    playerBody.linearDamping = 0.9;
    world.addBody(playerBody);

    loadAssets();
    window.addEventListener('resize', onWindowResize);
}

function loadAssets() {
    const gltfLoader = new GLTFLoader();

    // LOAD MAP
    gltfLoader.load('./assets/models/map.glb', (gltf) => {
        mapModel = gltf.scene;
        // Make map cast/receive shadows
        mapModel.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
        scene.add(mapModel);
        checkLoadStatus();
    }, undefined, (e) => console.error(e));

    // LOAD PLAYER/GUN
    gltfLoader.load('./assets/models/player.glb', (gltf) => {
        gunModel = gltf.scene;
        
        // TRUE FIRST PERSON VIEW CONFIGURATION:
        gunModel.scale.set(GUN_SCALE, GUN_SCALE, GUN_SCALE);
        gunModel.position.set(GUN_POS_X, GUN_POS_Y, GUN_POS_Z);
        
        // Sometimes models from blender face backwards. If your gun faces you, uncomment the line below:
        // gunModel.rotation.set(0, Math.PI, 0); 

        camera.add(gunModel);
        scene.add(camera);
        checkLoadStatus();
    }, undefined, (e) => console.error(e));

    // LOAD SOUND
    audioListener = new THREE.AudioListener();
    camera.add(audioListener);
    shootSound = new THREE.Audio(audioListener);
    
    const audioLoader = new THREE.AudioLoader();
    audioLoader.load('./assets/sound/shoot.mp3', (buffer) => {
        shootSound.setBuffer(buffer);
        shootSound.setVolume(0.6);
        checkLoadStatus();
    }, undefined, (e) => console.error(e));
}

function checkLoadStatus() {
    loadedAssets++;
    if (loadedAssets === totalAssets) {
        document.getElementById('loading-text').style.display = 'none';
        const startBtn = document.getElementById('btn-start');
        startBtn.style.display = 'block';
        
        startBtn.addEventListener('click', () => {
            document.getElementById('start-screen').style.display = 'none';
            document.getElementById('ui-layer').style.display = 'block'; // Show UI
            setupControls();
            
            if (document.documentElement.requestFullscreen) {
                document.documentElement.requestFullscreen();
            }
            animate();
        });
    }
}

function setupControls() {
    // 1. JOYSTICK (Movement)
    const joystickOptions = {
        zone: document.getElementById('joystick-zone'),
        mode: 'static',
        position: { left: '50%', top: '50%' },
        color: 'white'
    };
    const manager = nipplejs.create(joystickOptions);
    
    manager.on('move', (evt, data) => {
        // NippleJS vector: x is right/left, y is up/down
        moveData.x = data.vector.x; 
        moveData.y = data.vector.y;
    });

    manager.on('end', () => {
        moveData.x = 0;
        moveData.y = 0;
    });

    // 2. LOOK AROUND (Touch Right Screen)
    const lookZone = document.getElementById('look-zone');
    let touchStartX, touchStartY;
    
    lookZone.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    });

    lookZone.addEventListener('touchmove', (e) => {
        const touchX = e.touches[0].clientX;
        const touchY = e.touches[0].clientY;
        
        const deltaX = touchX - touchStartX;
        const deltaY = touchY - touchStartY;

        euler.y -= deltaX * LOOK_SENSITIVITY; // Left/Right
        euler.x -= deltaY * LOOK_SENSITIVITY; // Up/Down

        // Clamp Up/Down looking so camera doesn't flip over
        euler.x = Math.max(-Math.PI/2.2, Math.min(Math.PI/2.2, euler.x));
        
        camera.quaternion.setFromEuler(euler);

        touchStartX = touchX;
        touchStartY = touchY;
    });

    // 3. JUMP
    document.getElementById('btn-jump').addEventListener('touchstart', () => {
        // Can only jump if Y velocity is nearly 0 (touching ground)
        if (Math.abs(playerBody.velocity.y) < 1.5) {
            playerBody.velocity.y = JUMP_FORCE;
        }
    });

    // 4. FIRE
    document.getElementById('btn-fire').addEventListener('touchstart', shoot);
}

function shoot() {
    // Play sound
    if (shootSound.isPlaying) shootSound.stop();
    shootSound.play();

    // Muzzle flash effect
    const flash = new THREE.PointLight(0xffaa00, 5, 10);
    flash.position.set(0.4, -0.4, -2); // near the gun barrel
    camera.add(flash);
    setTimeout(() => { camera.remove(flash); }, 50);

    // Recoil Animation (moves gun back, then forward)
    if(gunModel) {
        gunModel.position.z += 0.1; 
        setTimeout(() => { gunModel.position.z -= 0.1; }, 50);
    }

    // Raycaster for Bullet Holes
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera); 

    if (mapModel) {
        const intersects = raycaster.intersectObject(mapModel, true);
        if (intersects.length > 0) {
            const hitPoint = intersects[0].point;
            const hitNormal = intersects[0].face.normal;
            
            // Create bullet hole / spark
            const hitGeo = new THREE.BoxGeometry(0.15, 0.15, 0.15);
            const hitMat = new THREE.MeshBasicMaterial({ color: 0xff3300 });
            const hitMesh = new THREE.Mesh(hitGeo, hitMat);
            
            // Push slightly out from wall to prevent Z-fighting
            hitMesh.position.copy(hitPoint).add(hitNormal.multiplyScalar(0.01));
            scene.add(hitMesh);
            
            // Remove after 2 seconds
            setTimeout(() => { scene.remove(hitMesh); }, 2000);
        }
    }
}

function updatePhysics() {
    // 1. Calculate Forward vector based on where camera is looking
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    forward.y = 0; // Don't fly up/down
    forward.normalize();

    // 2. Calculate Right vector based on where camera is looking
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    right.y = 0;
    right.normalize();

    // 3. Combine Joystick input with camera direction
    const moveVector = new THREE.Vector3();
    moveVector.addScaledVector(forward, moveData.y); // Up on joystick moves forward
    moveVector.addScaledVector(right, moveData.x);   // Right on joystick moves right
    moveVector.normalize().multiplyScalar(WALK_SPEED);

    // Apply to Physics Body (Keep current Y velocity for jumping/gravity)
    playerBody.velocity.x = moveVector.x;
    playerBody.velocity.z = moveVector.z;
}

function animate() {
    requestAnimationFrame(animate);

    // Step Physics
    world.step(1 / 60);
    updatePhysics();

    // Lock camera to player physics body (at Eye Height)
    const eyeHeight = 2.5; 
    camera.position.set(
        playerBody.position.x,
        playerBody.position.y + eyeHeight,
        playerBody.position.z
    );

    // Render Frame
    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}