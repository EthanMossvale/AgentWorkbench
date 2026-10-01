export function activate(api) {
  api.themes.register({id:'lagoon',label:'琉璃海',description:'通透蓝白 · 青玉绿',mode:'light',base:'builtin.sea',colors:{bg:'#f2f8f7',side:'#e2eeec',accent:'#296d63'},syntax:{keyword:'#76518c',string:'#2d6657'}});
  api.themes.register({id:'afterglow',label:'赤霞',description:'暮海蓝 · 珊瑚余晖',mode:'dark',base:'builtin.abyss',colors:{accent:'#e6ac99'},syntax:{keyword:'#d8afe3',string:'#b3cda6',number:'#efb29b'}});
  // Registration alone does not select a theme. User choices persist through appearance/set.
  // Both registrations are removed automatically on disable; the saved IDs remain intact.
}
