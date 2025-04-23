function getMousePosition(e) {
  if ('touches' in e) return e.touches[0].clientX
  return e.clientX
}

function getMouseMovement(e) {
  if ('touches' in e) return e.touches[0].movementX
  return e.movementX
}

const resize_handle = Vue.component('resize-handle', {
  props: {
    left_frame: Object,
    right_frame: Object,
    begin_drag_callback: Function,
    dragging_callback: Function,
    end_drag_callback: Function,
    last: Boolean
  },
  data() {
    return {
      moving: false,
      direction: null,
      start: undefined,
      width: 0,
      x: 0,
      hovered: false,
    }
  },
  mounted() {
    this.$nextTick(() => {
      this.start = this.$el.offsetLeft;
      this.width = this.$el.offsetWidth;
    })
  },
  methods: {
    begin_drag(e) {
      e.preventDefault();
      this.moving = true;
      this.x = evt.clientX;

      // Smooth throttled drag
      this.mousemove = (e) => {
        const offset = e.clientX - this.x;

        if (this.animationFrame) {
          cancelAnimationFrame(this.animationFrame);
        }

        this.animationFrame = requestAnimationFrame(() => {
          this.dragging_callback(this, offset);
        });
      };

      document.addEventListener("mousemove", this.mousemove); // use of throttled mousemove
      document.addEventListener("mouseup", this.end_drag);
      this.$parent.$el.style.cursor = "col-resize";
    },
    dragging(e) {
      e.preventDefault();
      if (!this.moving) return;

      let offset;
      let delta;

      // Calculate offset from start
      offset = getMousePosition(e) - this.start;
      this.x = this.start + offset;

      // Determine current movement direction
      delta = getMouseMovement(e);
      this.direction = delta < 0 ? "left" : delta > 0 ? "right" : null;

      // Smooth it out with animation frame throttle
      if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
      this.animationFrame = requestAnimationFrame(() => {
        this.dragging_callback(this, offset);
      });

    },
    end_drag(e) {
      e.preventDefault();
      this.moving = false;

      // Cancel any pending frame
      if (this.animationFrame) {
        cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
      }

      document.removeEventListener("mousemove", this.mousemove);
      document.removeEventListener("mouseup", this.end_drag);
      this.$parent.$el.style.cursor = "auto";

      this.end_drag_callback(this);

      this.$parent.syncRatios(); // Save new ratios after manual drag
    }
  },
  computed: {
    css() {
      let result = "handle";
      if (this.last) {
        result += " handle-last";
        if (!this.right_frame.visible) {
          result += " handle-hidden";
        }
      }
      return result;
    }
  },
  template: `
    <div :class="css">
      <div class="handle-grab-box"
        @mousedown="begin_drag"
        @mousemove="dragging"
        @mouseup="end_drag"
        @mouseenter="hovered = true"
        @mouseleave="hovered = false"
        :class="{ 'handle-hovered': hovered }">
      </div>
    </div>
  `
});

const frame = Vue.component('split-pane', {
  props: {
    fixed: { type: Boolean, required: false, default: false },
    resizable: { type: Boolean, required: false, default: true },
    collapsible: { type: Boolean, required: false, default: true },
    initial_width: { type: Number, required: false },
    min_width: { type: Number, required: false, default: 45 },
    max_width: { type: Number, required: false, default: Infinity },
  },
  data() {
    return {
      moving: false,
      direction: null,
      start: undefined,
      width: 0,
      x: 0,
      hovered: false,
      animationFrame: null
    }
  },
  computed: {
    slack() {
      return this.width - this.min_width;
    },
    locked() {
      return (this.slack == 0 ? true : false);
    },
    index() {
      return this.$parent.frames.indexOf(this);
    },
    first() {
      return this.$parent.frames.indexOf(this) == 1;
    },
    last() {
      const frames = this.$parent.frames;
      return frames.indexOf(this) == frames.length - 1;
    },
    css() {
      let result = "split-pane";
      if (!this.visible && (this.first || this.last)) {
        result += " split-pane-hidden";
      }
      return result;
    }
  },
  watch: {
    width: function (new_width) {
      this.$el.style.width = new_width + "px";
      this.x = this.$el.offsetLeft;

      if (this.min_width) {
        this.$el.style.minWidth = this.min_width + "px";
      }

      for (var i = 0; i < this.$children.length; i++) {
        const child = this.$children[i];
        child.$forceUpdate(); // Give child a chance to respond to width change
      }
    }
  },
  updated() {
    this.x = this.$el.offsetLeft;
  },
  mounted() {
    // Declare current width
    this.width = this.initial_width ? this.initial_width : this.min_width

    // Declare minimum width
    this.$el.style.minWidth = this.min_width
    if (this.max_width != Infinity) this.$el.style.maxWidth = this.max_width

    this.save()
  },
  methods: {
    save() {
      this.start = this.width;
    },
    collapse() {
      this.visible = false;
    },
    expand() {
      if (this.visible) return; // Already visible? Don't re-expand
      this.visible = true;

      this.$el.style.display = 'block';
      this.$el.style.width = `${this.width}px`; // fallback width just in case
      this.$el.offsetWidth; // force reflow again

      console.log("Expanding frame", this._uid, "→ visible:", this.visible);
      console.log("Parent saved_ratios BEFORE resize:", this.$parent.saved_ratios);

      // Only add a new ratio for this frame if it’s missing
      const uid = this._uid;
      if (!this.$parent.saved_ratios[uid]) {
        const total_fluid_width = this.$parent.frames
          .filter(f => !f.fixed && f.visible && f._uid !== uid)
          .reduce((acc, f) => acc + f.width, 0);

        // Assign a default ratio for the newly expanded frame
        this.$parent.saved_ratios[uid] = this.min_width / (total_fluid_width + this.min_width);
      }

      this.$parent.resize(); // force layout to reapply saved_ratios
      this.$parent.syncRatios(); // stores them again

    }
  },
  template: `
    <div :class="css">
      <slot v-on:close="evt_close"></slot>
    </div>
  `
})

const frame_container = Vue.component('split-pane-container', {
  data() {
    return {
      saved_ratios: {},
    };
  },

  created() {
    this.saved_ratios = {};
  },

  computed: {
    children() {
      return this.$children;
    },
    frames() {
      return this.$children.filter(child => child.$options.name === "split-pane");
    },
    handles() {
      return this.$children.filter(child => child.$options.name === "resize-handle");
    },
    layout() {
      const layout = {
        fixed_fr_count: this.frames.filter(frame => frame.fixed).length,
        fluid_fr_count: this.frames.filter(frame => !frame.fixed).length,
        handle_space: this.handles.reduce((acc, handle) => acc + handle.width, 0),
        fixed_fr_space: this.frames.filter(frame => frame.fixed).reduce((acc, frame) => acc + frame.width, 0),
        fluid_fr_space: this.frames.filter(frame => !frame.fixed).reduce((acc, frame) => acc + frame.width, 0),
      };
      return layout;
    },
  },
  mounted() {

    window.controller = this;

    // Initialize frame dimensions
    this.resize();

    // When window resizes, resize frames.
    window.addEventListener("resize", () => {
      this.resize()
    });

    // Instantiate handles
    for (let i = 0; i < this.frames.length - 1; i++) {
      let frame = this.frames[i];
      if (!frame.resizable) {
        continue;
      }

      let handle_class = Vue.extend(resize_handle)
      let handle_instance = new handle_class({
        propsData: {
          left_frame: this.frames[i],
          right_frame: this.frames[i + 1],
          begin_drag_callback: this.begin_adjust,
          dragging_callback: this.adjust,
          end_drag_callback: this.end_adjust,
          last: i == (this.frames.length - 2)
        }
      });

      // Set ancestry
      this.$children.push(handle_instance);
      this.handles.push(handle_instance);
      handle_instance.$parent = this;

      handle_instance.$mount();
      frame.$el.after(handle_instance.$el);
    }
  },

  methods: {
    has_active_children(frame) {
      let result = 0;

      for (let i = 0; i < frame.$children.length; i++) {
        const child = frame.$children[i];
        const css = child.$el.classList;
        if (!css.contains("disable")) {
          result++;
        }
      }

      return result != 0;
    },

    resize() {
      let collapsed_width = 0;

      // Collapse inactive frames
      for (const frame of this.frames) {
        let active = true;
        if (frame.collapsible) {
          active = this.has_active_children(frame);
        }

        if (!active) {
          if (frame.fixed) {
            collapsed_width += frame.width - 1;
          }
          frame.collapse();
        } else {
          frame.expand();
        }
      }

      // Capture available and demanded space at moment
      let application_width = this.$el.offsetWidth;
      let free_sp = application_width - (this.layout.fixed_fr_space + this.layout.handle_space) + collapsed_width;
      let demanded_sp = this.layout.fluid_fr_space;


      // Apply saved ratios
      for (const frame of this.frames) {
        let active = true;
        if (frame.collapsible) {
          active = this.has_active_children(frame);
        }

        if (!active) {
          frame.collapse();
          continue;
        }

        frame.expand();

        if (!frame.fixed && frame.visible) {
          const ratio = this.saved_ratios[frame._uid] || (frame.width / demanded_sp);
          const new_width = ratio * free_sp;

          // Debug Log
          console.log(`Applying ratio for frame ${frame._uid} →`, {
            ratio,
            free_sp,
            new_width,
            min_width: frame.min_width
          });
          console.log(`[Resize] Frame ${frame._uid}: ratio=${ratio}, free_sp=${free_sp}, new_width=${new_width}`);

          frame.width = new_width >= frame.min_width ? new_width : frame.min_width;
          frame.$el.style.width = `${frame.width}px`;
          frame.$el.style.display = 'block'; // Optional force unhide
          frame.$el.offsetWidth; // Force reflow

          console.warn(`Frame ${frame._uid} is visible but has no rendered width`);


          console.log("Frame applied →", {
            uid: frame._uid,
            visible: frame.visible,
            width: frame.width,
            element_width: frame.$el.offsetWidth,
            el: frame.$el
          });

        }

        frame.save();
      }

      console.log("Frames + widths:");
      this.frames.forEach(f => {
        console.log(f._uid, f.width, f.visible);
      });

    },

    syncRatios() {
      console.log("syncRatios called");
      this.saved_ratios = {}; // Clear old ratios

      // DEBUG: Log the actual frame widths
      console.log('Saving ratios:', this.frames.map(f => ({
        uid: f._uid,
        width: f.width,
        visible: f.visible,
        fixed: f.fixed
      })));

      const total_fluid_width = this.frames
        .filter(f => !f.fixed && f.visible)
        .reduce((acc, f) => acc + f.width, 0);

      const free_sp = this.$el.offsetWidth - this.layout.fixed_fr_space - this.layout.handle_space;
      const demanded_sp = this.layout.fluid_fr_space;

      // Build the saved_ratios map (UID → fraction of total)
      for (const frame of this.frames) {
        if (!frame.fixed && frame.visible) {
          // Save each pane’s share of the total
          this.saved_ratios[frame._uid] = frame.width / total_fluid_width;

        }
        frame.save();
      }

      console.log("Saved Ratios:", this.saved_ratios);
      console.log("Demanded SP:", demanded_sp);
      console.log("Free SP:", free_sp);

    },

    begin_adjust(handle) {
      handle.left_frame.active = handle.right_frame.active = true;
    },

    adjust(handle, offset) {
      const lfr = handle.left_frame;
      const rfr = handle.right_frame;

      // Ensure starting width values are up-to-date before applying offset
      lfr.start = lfr.width;
      rfr.start = rfr.width;

      let current_step = {
        left: lfr.width,
        right: rfr.width
      }

      // Limit offset speed to max 85% of total container width
      const container_width = this.$el.offsetWidth;
      const MAX_RATIO = 0.85;
      const offset_limit = container_width * MAX_RATIO;

      // Dampen offset speed to reduce harsh movement
      const DAMPING_FACTOR = 0.35;
      offset = offset * DAMPING_FACTOR;

      // Clamp offset if it exceeds max allowed delta
      if (Math.abs(offset) > offset_limit) {
        offset = offset < 0 ? -offset_limit : offset_limit;
      }

      let next_step = {
        left: lfr.start + offset,
        right: rfr.start - offset
      };

      // Prevent dragging beyond ratio
      if (next_step.left > container_width * MAX_RATIO) return;
      if (next_step.right > container_width * MAX_RATIO) return;

      let valid_step = next_step.left >= lfr.min_width && next_step.left < lfr.max_width && next_step.right >= rfr.min_width && next_step.right < rfr.max_width;

      if (handle.direction == "left") {
        if (valid_step) {
          lfr.width = next_step.left;
          rfr.width = next_step.right;
        } else {
          if (next_step.left < lfr.min_width) {
            let diff = lfr.start - lfr.min_width;
            lfr.width = lfr.min_width;
            rfr.width = rfr.start + diff;
          }
        }
      }

      if (handle.direction == "right") {
        if (valid_step) {
          lfr.width = next_step.left;
          rfr.width = next_step.right;
        } else {
          if (next_step.right < rfr.min_width) {
            let diff = rfr.start - rfr.min_width;
            rfr.width = rfr.min_width;
            lfr.width = lfr.start + diff;
          }
        }
      }

    },

    end_adjust(handle) {
      handle.left_frame.active = handle.right_frame.active = false;
      for (const frame of this.frames) {
        frame.save();
      }

      this.syncRatios(); // Save final proportions AFTER adjustments are done
    },

  },
  template: `
  <div class="split-pane-container">
    <slot></slot>
  </div>
  `
});