// custom-controls.js

(function () {
  const Plugin = videojs.getPlugin('plugin');

  function logIf(opts, ...args) {
    if (opts?.log) console.log('[vjs-custom]', ...args);
  }

  async function loadSVG(path, opts) {
    try {
      const res = await fetch(path, { cache: 'force-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const svgText = await res.text();
      return svgText;
    } catch (err) {
      logIf(opts, `Failed to load SVG: ${path}`, err);
      return null;
    }
  }

  function setButtonSVG(el, svgText, sizeClass = 'vjs-icon-svg') {
    el.innerHTML = '';
    if (!svgText) return;
    const container = document.createElement('span');
    container.className = sizeClass;
    container.innerHTML = svgText;
    el.appendChild(container);
  }

  // Base class for SVG icon buttons
  const VjsButton = videojs.getComponent('Button');

  class SVGIconButton extends VjsButton {
    constructor(player, options) {
      super(player, options);
      this.opts = options || {};
      this.iconBasePath = this.opts.iconBasePath || '/img/icon';
      this.currentIcon = null;

      this.el().classList.add('vjs-custom-button');
      if (this.opts?.label) {
        this.controlText(this.opts.label);
        this.el().setAttribute('aria-label', this.opts.label);
      }
      // Initial icon
      this.updateIcon(this.opts.icon);
    }

    async updateIcon(iconName) {
      if (!iconName || iconName === this.currentIcon) return;
      this.currentIcon = iconName;
      const path = `${this.iconBasePath}/${iconName}.svg`;
      const svg = await loadSVG(path, this.opts);
      if (!svg) {
        // fallback to text label if SVG failed
        this.el().textContent = this.opts?.label || iconName;
        return;
      }
      setButtonSVG(this.el(), svg);
    }

    // Override for click handling
    handleClick() {
      if (typeof this.opts.onClick === 'function') {
        try {
          this.opts.onClick.call(this, this.player_);
        } catch (err) {
          logIf(this.opts, 'onClick error', err);
        }
      }
    }
  }

  videojs.registerComponent('SVGIconButton', SVGIconButton);

  // Volume icon logic
  function volumeIconFor(player) {
    if (player.muted() || player.volume() === 0) return 'audio_mute';
    const v = player.volume();
    if (v <= 0.33) return 'audio_low';
    if (v <= 0.66) return 'audio_mid';
    return 'audio_full';
  }

  // Big overlay button helper (replaces BigPlayButton content)
  async function setBigOverlaySVG(player, iconBasePath, name) {
    const big = player.getChild('BigPlayButton');
    if (!big) return;
    const el = big.el();
    const svg = await loadSVG(`${iconBasePath}/${name}.svg`, { log: false });
    if (!svg) return;
    el.innerHTML = '';
    const container = document.createElement('span');
    container.className = 'vjs-big-button-svg';
    container.innerHTML = svg;
    el.appendChild(container);
  }

  // Settings menu (stub)
  function ensureSettingsMenu(player) {
    let menu = player.el().querySelector('.vjs-settings-menu');
    if (!menu) {
      menu = document.createElement('div');
      menu.className = 'vjs-settings-menu hidden';
      menu.innerHTML = `
        <h6>Settings</h6>
        <div class="vjs-settings-item" data-key="playbackRate">
          <span>Playback speed</span><span class="value">1.0x</span>
        </div>
        <div class="vjs-settings-item" data-key="quality">
          <span>Quality</span><span class="value">Auto</span>
        </div>
      `;
      player.el().appendChild(menu);

      // Simple interactions
      menu.addEventListener('click', (e) => {
        const item = e.target.closest('.vjs-settings-item');
        if (!item) return;
        const key = item.getAttribute('data-key');
        if (key === 'playbackRate') {
          const current = player.playbackRate();
          const next = current >= 2 ? 1 : (Math.round((current + 0.25) * 100) / 100);
          player.playbackRate(next);
          item.querySelector('.value').textContent = `${next}x`;
        }
        // Quality integration would go here if using HLS/ABR libs
      });
    }
    return menu;
  }

  // PiP helpers
  async function enterPiP(videoEl) {
    if (document.pictureInPictureElement) return;
    if (document.pictureInPictureEnabled && videoEl.requestPictureInPicture) {
      await videoEl.requestPictureInPicture();
    } else {
      throw new Error('Picture-in-Picture not supported');
    }
  }
  async function exitPiP() {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    }
  }

  // The plugin that wires everything
  class CustomControls extends Plugin {
    constructor(player, options = {}) {
      super(player, options);
      this.opts = { iconBasePath: '/img/icon', log: false, ...options };

      this.setup();
    }

    async setup() {
      const player = this.player;
      const opts = this.opts;
      logIf(opts, 'Initializing custom controls');

      // Replace default icons on play/pause big overlay
      setBigOverlaySVG(player, opts.iconBasePath, 'bigplay');

      player.on('play', () => setBigOverlaySVG(player, opts.iconBasePath, 'bigpause'));
      player.on('pause', () => setBigOverlaySVG(player, opts.iconBasePath, 'bigplay'));
      player.on('ended', () => setBigOverlaySVG(player, opts.iconBasePath, 'bigstop'));

      // Remove some defaults we are replacing
      const controlBar = player.getChild('controlBar');
      if (!controlBar) return;

      // Play/Pause
      controlBar.removeChild('playToggle');
      const playPause = controlBar.addChild('SVGIconButton', {
        iconBasePath: opts.iconBasePath,
        label: 'Play/Pause',
        icon: player.paused() ? 'play' : 'pause',
        log: opts.log,
        onClick(p) {
          if (p.paused()) p.play();
          else p.pause();
          this.updateIcon(p.paused() ? 'play' : 'pause');
        }
      });

      player.on(['play', 'pause'], () => {
        playPause.updateIcon(player.paused() ? 'play' : 'pause');
      });

      // Stop
      const stopBtn = controlBar.addChild('SVGIconButton', {
        iconBasePath: opts.iconBasePath,
        label: 'Stop',
        icon: 'stop',
        log: opts.log,
        onClick(p) {
          try {
            p.pause();
            p.currentTime(0);
            setBigOverlaySVG(p, opts.iconBasePath, 'bigplay');
          } catch (err) {
            logIf(opts, 'Stop error', err);
          }
        }
      });

      // Volume/Mute
      controlBar.removeChild('muteToggle');
      controlBar.removeChild('volumePanel');
      const volumeBtn = controlBar.addChild('SVGIconButton', {
        iconBasePath: opts.iconBasePath,
        label: 'Mute/Volume',
        icon: volumeIconFor(player),
        log: opts.log,
        onClick(p) {
          p.muted(!p.muted());
          this.updateIcon(volumeIconFor(p));
        }
      });

      const volumeSlider = controlBar.addChild('volumePanel'); // keep slider if desired
      // If you prefer a slimmer layout, comment the above and implement your own slider.

      player.on(['volumechange'], () => {
        volumeBtn.updateIcon(volumeIconFor(player));
      });

      // Settings (Gear)
      const gearBtn = controlBar.addChild('SVGIconButton', {
        iconBasePath: opts.iconBasePath,
        label: 'Settings',
        icon: 'gear',
        log: opts.log,
        onClick(p) {
          const menu = ensureSettingsMenu(p);
          const open = menu.classList.toggle('hidden') === false;
          this.updateIcon(open ? 'gear_open' : 'gear');
        }
      });

      // Picture-in-Picture
      const techEl = player.tech_?.el();
      const pipBtn = controlBar.addChild('SVGIconButton', {
        iconBasePath: opts.iconBasePath,
        label: 'Picture-in-Picture',
        icon: 'pip',
        log: opts.log,
        async onClick(p) {
          try {
            const isActive = !!document.pictureInPictureElement;
            if (isActive) {
              await exitPiP();
              this.updateIcon('pip');
            } else {
              await enterPiP(techEl);
              this.updateIcon('pip_exit');
            }
          } catch (err) {
            logIf(opts, 'PiP error', err);
          }
        }
      });

      // Fullscreen
      controlBar.removeChild('fullscreenToggle');
      const fsBtn = controlBar.addChild('SVGIconButton', {
        iconBasePath: opts.iconBasePath,
        label: 'Fullscreen',
        icon: 'full',
        log: opts.log,
        onClick(p) {
          try {
            if (p.isFullscreen()) {
              p.exitFullscreen();
              this.updateIcon('full');
            } else {
              p.requestFullscreen();
              this.updateIcon('full_exit');
            }
          } catch (err) {
            logIf(opts, 'Fullscreen error', err);
          }
        }
      });

      player.on('fullscreenchange', () => {
        fsBtn.updateIcon(player.isFullscreen() ? 'full_exit' : 'full');
      });

      // Optional: reorder controls to your preference
      try {
        controlBar.el().style.display = 'flex';
        // Example ordering: play/pause | stop | volume | settings | pip | fullscreen | time, etc.
        const order = [playPause, stopBtn, volumeBtn, gearBtn, pipBtn, fsBtn];
        order.forEach((c, idx) => c.el().style.order = idx);
      } catch (err) {
        logIf(opts, 'Ordering error', err);
      }

      logIf(opts, 'Custom controls initialized');
    }
  }

  videojs.registerPlugin('customControls', CustomControls);
})();
