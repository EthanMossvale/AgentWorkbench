export interface WindowBounds {x?:number;y?:number;width:number;height:number}
export interface DisplayArea {x:number;y:number;width:number;height:number}
/** Fit the effective window without changing the user's saved preferred bounds. */
export function fitWindow(preferred:WindowBounds,areas:DisplayArea[]):WindowBounds {
  const fallback=areas[0]??{x:0,y:0,width:1920,height:1080};
  const cx=(preferred.x??fallback.x)+(preferred.width/2),cy=(preferred.y??fallback.y)+(preferred.height/2);
  const area=areas.find(a=>cx>=a.x&&cx<a.x+a.width&&cy>=a.y&&cy<a.y+a.height)??fallback;
  const width=Math.min(area.width,Math.max(Math.min(860,area.width),preferred.width)),height=Math.min(area.height,Math.max(Math.min(640,area.height),preferred.height));
  return {width:Math.round(width),height:Math.round(height),x:Math.round(Math.max(area.x,Math.min(area.x+area.width-width,preferred.x??area.x+(area.width-width)/2))),y:Math.round(Math.max(area.y,Math.min(area.y+area.height-height,preferred.y??area.y+(area.height-height)/2)))};
}
