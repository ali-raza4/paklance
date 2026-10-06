/* Turns on the homepage motion unless the visitor prefers reduced motion. */
try{if(!window.matchMedia("(prefers-reduced-motion: reduce)").matches)document.documentElement.classList.add("anim")}catch(e){}
