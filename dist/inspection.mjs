// Touch scrolling stays native until a stationary hold activates inspection.
export function createHoldInspector({select, schedule = setTimeout, unschedule = clearTimeout, delay = 350, tolerance = 10}) {
  let timer = null, origin = null, active = false;
  const cancel = () => {
    if (timer !== null) unschedule(timer);
    timer = null; origin = null; active = false;
  };
  return {
    start(x, y) {
      cancel(); origin = {x, y};
      timer = schedule(() => {timer = null; active = true; select(x);}, delay);
    },
    move(x, y) {
      if (!origin) return false;
      if (active) {select(x); return true;}
      if (Math.hypot(x - origin.x, y - origin.y) > tolerance) cancel();
      return false;
    },
    end() {const consumed = active; cancel(); return consumed;},
    cancel
  };
}
