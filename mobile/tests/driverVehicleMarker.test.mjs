import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const mocks = {
  react: `export const useEffect=()=>{}; export const useMemo=fn=>fn();
    export const useRef=value=>({current:value}); export const useState=value=>[value,()=>{}];`,
  'react/jsx-runtime': 'export const jsx=(type,props)=>({type,props}); export const jsxs=jsx;',
  'react-native': 'export const View="View"; export const StyleSheet={create:value=>value};',
  'react-native-maps': 'export const Marker="Marker";',
  'react-native-reanimated': 'export const useReducedMotion=()=>true;',
  '@/core/theme': 'export const useEstilos=f=>({styles:f({colors:{}}),modo:"light"});',
  '@/shared/components/mapa/VehiculoMapa': 'export const VehiculoMapa="VehicleDrawing";',
  '@/features/rides/presentation/routeTooltipLayout': 'export const programarRedibujadoMarcador=()=>{};',
};
const hooks=registerHooks({
  resolve(specifier,context,next){
    if(specifier in mocks)return{url:'marker-test:'+specifier,shortCircuit:true};
    if(specifier==='./rumboVehiculo')return next(new URL('../src/features/driver/presentation/rumboVehiculo.ts',import.meta.url).href,context);
    return next(specifier,context);
  },
  load(url,context,next){
    if(url.startsWith('marker-test:'))return{format:'module',shortCircuit:true,source:mocks[url.slice(12)]};
    if(/\.tsx?$/.test(url))return{format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{
      compilerOptions:{module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX},fileName:url,
    }).outputText};
    return next(url,context);
  },
});
const {MarcadorVehiculo}=await import('../src/features/driver/presentation/MarcadorVehiculo.tsx');
hooks.deregister();
const coordinates={latitude:-17.79,longitude:-63.19};
for(const vehicle of ['taxi','moto'])for(const heading of [null,-1]){
  test(`${vehicle} remains visible when GPS heading is ${heading}`,()=>{
    const marker=MarcadorVehiculo({coordinates,heading,tipoVehiculo:vehicle});
    const [slot,dot]=marker.props.children.props.children;
    assert.equal(slot.props.style.at(-1).opacity,1);
    assert.equal(slot.props.children[0].type,'VehicleDrawing');
    assert.equal(slot.props.children[0].props.tipo,vehicle);
    assert.equal(slot.props.children[1].props.style.at(-1).opacity,0);
    assert.equal(dot.props.style.at(-1).opacity,0);
    assert.equal(marker.props.coordinate,coordinates);
  });
}
test('new GPS positions update the vehicle marker and retain stale-signal opacity',()=>{
  const next={latitude:-17.7901,longitude:-63.1901};
  const marker=MarcadorVehiculo({coordinates:next,heading:90,tipoVehiculo:'moto',opacity:0.5,label:'Ubicación del conductor'});
  assert.equal(marker.props.coordinate,next);
  assert.equal(marker.props.rotation,90);
  assert.equal(marker.props.opacity,0.5);
  assert.equal(marker.props.accessibilityLabel,'Ubicación del conductor');
});
