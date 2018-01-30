anime.timeline({loop: false})
  .add({
    targets: '.ml15 .word',
    scale: [14,1],
    opacity: [0,1],
    easing: "easeOutCirc",
    duration: 1000,
    delay: function(el, i) {
      return 800 * i;
    }
  }).add({
    targets: '.ml15',
    duration: 1000,
    easing: "easeOutExpo",
    delay: 1000
  });
