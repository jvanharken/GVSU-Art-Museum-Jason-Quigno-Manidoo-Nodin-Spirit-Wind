export function makeOvalShadowMaterial(opacity=0.85){
  return new THREE.ShaderMaterial({
    uniforms: { opacity: { value: opacity } },
    vertexShader: `varying vec2 vUv;void main(){vUv=uv*2.0-1.0;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `precision mediump float;varying vec2 vUv;uniform float opacity;void main(){float bx=0.95;float by=0.6;float rr=(vUv.x*vUv.x)/(bx*bx)+(vUv.y*vUv.y)/(by*by);float a=smoothstep(1.0,0.0,rr);a=pow(a,1.5);gl_FragColor=vec4(0.0,0.0,0.0,a*opacity);if(gl_FragColor.a<=0.001)discard;}`,
    transparent: true
  });
}