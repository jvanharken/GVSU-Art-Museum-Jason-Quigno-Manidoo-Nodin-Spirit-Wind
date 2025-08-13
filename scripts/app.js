import { makeOvalShadowMaterial } from './ovalShadowShader.js';
import { GestureControls } from './gestureControls.js';

const VIDEO_SRC = './assets/greenscreen.mp4';
const PLY_SRC = './assets/splat.ply';
const KEY_COLOR = new THREE.Color(0.13333334, 0.72941178, 0.18039216);
const SIMILARITY = 0.23, SMOOTHNESS = 0.07, SPILL = 0.10;

let renderer, scene, camera, hitTestSource=null, hitTestSourceRequested=false, localSpace=null;
let reticleEl, enterBtn, playBtn, resetBtn, instructions, placeHint;
let video, videoTexture, videoMesh, shadowMesh, placedRoot, plyMesh;
let lastHitPose=null, placed=false, baseScale=1, plyFadeState='hidden';

init();

async function init(){ setupUI(); setupThree(); setupMedia(); renderer.setAnimationLoop(render); }

function setupUI(){
  reticleEl=document.getElementById('reticle'); enterBtn=document.getElementById('enterAR'); playBtn=document.getElementById('playBtn');
  resetBtn=document.getElementById('resetBtn'); instructions=document.getElementById('instructions'); placeHint=document.getElementById('placeHint');
  enterBtn.addEventListener('click', startAR); playBtn.addEventListener('click', togglePlay); resetBtn.addEventListener('click', resetPlacement);
  new GestureControls(document.body,{ onScale:s=>{ if(placed&&placedRoot){ const c=Math.max(0.3,Math.min(3.0,baseScale*s)); placedRoot.scale.set(c,c,c); }}, onRotate:r=>{ if(placed&&placedRoot) placedRoot.rotation.y+=r; } });
  window.addEventListener('pointerdown', tryPlace);
  window.addEventListener('resize', ()=>{ renderer.setSize(window.innerWidth,window.innerHeight); camera.aspect=window.innerWidth/window.innerHeight; camera.updateProjectionMatrix(); });
}

function setupThree(){
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2)); renderer.setSize(window.innerWidth,window.innerHeight); renderer.xr.enabled=true;
  document.body.appendChild(renderer.domElement);
  scene=new THREE.Scene(); camera=new THREE.PerspectiveCamera();
  scene.add(new THREE.HemisphereLight(0xffffff,0x444444,1.0));
  const dir=new THREE.DirectionalLight(0xffffff,0.7); dir.position.set(1,3,2); scene.add(dir);
}

function setupMedia(){
  video=document.createElement('video'); video.src=VIDEO_SRC; video.crossOrigin='anonymous'; video.loop=true; video.playsInline=true; video.preload='metadata';
  const tex=new THREE.VideoTexture(video); tex.colorSpace=THREE.SRGBColorSpace; videoTexture=tex;
  const chroma=new THREE.ShaderMaterial({
    uniforms:{ map:{value:tex}, keyColor:{value:KEY_COLOR}, similarity:{value:SIMILARITY}, smoothness:{value:SMOOTHNESS}, spill:{value:SPILL} },
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:'precision mediump float;uniform sampler2D map;uniform vec3 keyColor;uniform float similarity;uniform float smoothness;uniform float spill;varying vec2 vUv;void main(){vec4 c=texture2D(map,vUv);float d=distance(c.rgb,keyColor);float e0=similarity*(1.0-smoothness);float e1=similarity;float a=smoothstep(e0,e1,d);float des=clamp((c.g-max(c.r,c.b))*spill*4.0,0.0,1.0);vec3 col=mix(c.rgb,vec3((c.r+c.b)*0.5),des);gl_FragColor=vec4(col,a);if(gl_FragColor.a<0.02)discard;}',
    transparent:true
  });
  videoMesh=new THREE.Mesh(new THREE.PlaneGeometry(0.8,0.45),chroma);
  shadowMesh=new THREE.Mesh(new THREE.PlaneGeometry(0.9,0.5), makeOvalShadowMaterial(0.85)); shadowMesh.rotation.x=-Math.PI/2; shadowMesh.position.y=0.001;
  placedRoot=new THREE.Group(); placedRoot.visible=false; placedRoot.add(shadowMesh); placedRoot.add(videoMesh); scene.add(placedRoot);
  const loader=new THREE.PLYLoader(); loader.load(PLY_SRC,(g)=>{ g.computeVertexNormals(); const m=new THREE.MeshStandardMaterial({color:0xffffff,metalness:0.0,roughness:1.0,transparent:true,opacity:0.0}); plyMesh=new THREE.Mesh(g,m); plyMesh.position.set(0,0,-0.2); plyMesh.scale.set(0.5,0.5,0.5); placedRoot.add(plyMesh); });
  video.addEventListener('timeupdate', () => {
    if (!isFinite(video.duration) || video.duration <= 0 || !plyMesh) return;
    const t = video.currentTime;
    const d = video.duration;
    if (t < 1 && (plyFadeState === 'visible' || plyFadeState === 'fading-out')) {
      plyMesh.material.opacity = 0.0;
      plyFadeState = 'hidden';
    }
    const tIn = d * 0.5;
    const tOut = Math.max(d - 5.0, d * 0.8);
    if (t >= tIn && plyFadeState === 'hidden') {
      plyFadeState = 'fading-in';
      tweenOpacity(plyMesh.material, 0.0, 1.0, 1.0, () => { plyFadeState = 'visible'; });
    }
    if (t >= tOut && plyFadeState === 'visible') {
      plyFadeState = 'fading-out';
      tweenOpacity(plyMesh.material, 1.0, 0.0, 1.0, () => { plyFadeState = 'hidden'; });
    }
  });
}

async function startAR(){
  try{ const session=await navigator.xr.requestSession('immersive-ar',{requiredFeatures:['hit-test','local-floor']}); renderer.xr.setReferenceSpaceType('local-floor'); await renderer.xr.setSession(session);
    document.getElementById('enterAR').classList.add('hidden'); document.getElementById('placeHint').style.display='block'; document.getElementById('reticle').style.display='block';
    session.addEventListener('end',()=>{ document.getElementById('playBtn').style.display='none'; document.getElementById('reticle').style.display='none'; document.getElementById('placeHint').style.display='none'; document.getElementById('instructions').classList.remove('hidden'); hitTestSourceRequested=false; hitTestSource=null; localSpace=null; });
  }catch(e){ console.error(e); document.getElementById('enterAR').textContent='AR failed (use HTTPS + AR browser)'; }
} 

function tryPlace(){
  const xr=renderer.xr.getSession(); if(!xr||!lastHitPose)return;
  const aspect=(video.videoWidth&&video.videoHeight)?(video.videoWidth/video.videoHeight):(16/9);
  const width=0.8, height=width/aspect;
  videoMesh.geometry.dispose(); videoMesh.geometry=new THREE.PlaneGeometry(width,height);
  shadowMesh.geometry.dispose(); shadowMesh.geometry=new THREE.PlaneGeometry(width*1.15,height*0.75);
  if(!placed){ placed=true; placedRoot.visible=true; document.getElementById('instructions').classList.add('hidden'); document.getElementById('playBtn').disabled=false; baseScale=1; }
  placedRoot.matrix.fromArray(lastHitPose.transform.matrix); placedRoot.matrix.decompose(placedRoot.position, placedRoot.quaternion, placedRoot.scale); placedRoot.position.y+=0.01;
}

function resetPlacement(){ placed=false; placedRoot.visible=false; document.getElementById('playBtn').disabled=true; document.getElementById('instructions').classList.remove('hidden'); video.pause(); document.getElementById('playBtn').textContent='▶︎ Play Video'; }

async function togglePlay(){ try{ if(video.paused){ await video.play(); document.getElementById('playBtn').textContent='⏸ Pause'; } else { video.pause(); document.getElementById('playBtn').textContent='▶︎ Play Video'; } }catch(e){ console.warn('Play failed',e); } }

function tweenOpacity(mat, from, to, sec, onComplete) {
  const start = performance.now();
  function step(now) {
    const t = Math.min(1, (now - start) / (sec * 1000));
    mat.opacity = from + (to - from) * t;
    mat.needsUpdate = true;
    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      if (onComplete) onComplete();
    }
  }
  requestAnimationFrame(step);
}

async function render(ts,frame){ const session=renderer.xr.getSession(); if(frame&&session){ const ref=renderer.xr.getReferenceSpace(); if(!hitTestSourceRequested){ const viewer=await session.requestReferenceSpace('viewer'); hitTestSource=await session.requestHitTestSource({space:viewer}); localSpace=ref; hitTestSourceRequested=true; } if(hitTestSource){ const hits=frame.getHitTestResults(hitTestSource); if(hits.length>0){ const hit=hits[0]; lastHitPose=hit.getPose(localSpace); document.getElementById('reticle').style.display='block'; document.getElementById('reticle').style.opacity='1'; } else { document.getElementById('reticle').style.opacity='0.3'; } } renderer.render(scene,camera); }
