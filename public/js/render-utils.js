export function collectTintTargets(root) {
  const targets=[];
  root?.traverse?.(object=>{
    if(object.isMesh && object.material?.color && !object.userData?.noTint) targets.push(object);
  });
  return targets;
}

export function applyBurnTint(targets,progress) {
  const multiplier=1-Math.min(1,Math.max(0,progress))*.68;
  for(const object of targets) {
    if(!object.userData.base) object.userData.base=object.material.color.clone();
    object.material.color.copy(object.userData.base).multiplyScalar(multiplier);
  }
}
