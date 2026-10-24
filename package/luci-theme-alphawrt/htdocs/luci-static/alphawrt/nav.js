/* AlphaWRT header: menu toggle and tap-to-open groups on narrow screens.
 * Wide screens open groups on hover and keyboard focus (CSS only). */
(function() {
	'use strict';

	function header() { return document.querySelector('header'); }

	function narrow() {
		const t = document.querySelector('.nav-toggle');
		return t && getComputedStyle(t).display !== 'none';
	}

	function closeGroups(except) {
		header().querySelectorAll('.dropdown.open').forEach(function(li) {
			if (li !== except) {
				li.classList.remove('open');
				li.firstElementChild.setAttribute('aria-expanded', 'false');
			}
		});
	}

	function setMenu(open) {
		const h = header(), t = h.querySelector('.nav-toggle');
		h.classList.toggle('nav-open', open);
		t.setAttribute('aria-expanded', String(open));
	}

	document.addEventListener('click', function(ev) {
		if (!header())
			return;

		if (ev.target.closest('.nav-toggle')) {
			setMenu(!header().classList.contains('nav-open'));
			return;
		}

		const link = ev.target.closest('header .dropdown > a.menu');

		if (link) {
			ev.preventDefault();

			if (narrow()) {
				const li = link.parentNode, open = !li.classList.contains('open');
				closeGroups(li);
				li.classList.toggle('open', open);
				link.setAttribute('aria-expanded', String(open));
			}
		}
	});

	document.addEventListener('keydown', function(ev) {
		if (ev.key !== 'Escape' || !header())
			return;

		closeGroups();

		if (header().classList.contains('nav-open')) {
			setMenu(false);
			header().querySelector('.nav-toggle').focus();
		}
		else if (document.activeElement && document.activeElement.closest('header .dropdown')) {
			document.activeElement.blur();
		}
	});
})();
