// Mobile Menu Toggle
function setupMobileMenu() {
    const mobileMenuBtn = document.querySelector('.mobile-menu-toggle');
    const mainNav = document.querySelector('.main-nav');
    
    if (mobileMenuBtn) {
        safeAddEventListener(mobileMenuBtn, 'click', function() {
            this.classList.toggle('active');
            if (mainNav) mainNav.classList.toggle('active');
            
            // Toggle menu button appearance
            const spans = this.querySelectorAll('span');
            if (spans && spans.length > 0) {
                if (this.classList.contains('active')) {
                    spans[0].style.transform = 'rotate(45deg) translate(5px, 5px)';
                    if (spans[1]) spans[1].style.opacity = '0';
                    if (spans[2]) spans[2].style.transform = 'rotate(-45deg) translate(5px, -5px)';
                } else {
                    spans[0].style.transform = 'none';
                    if (spans[1]) spans[1].style.opacity = '1';
                    if (spans[2]) spans[2].style.transform = 'none';
                }
            }
        });
    }
    
    // Close menu when clicking links
    const navLinks = document.querySelectorAll('.main-nav a');
    navLinks.forEach(link => {
        safeAddEventListener(link, 'click', function() {
            if (mainNav) mainNav.classList.remove('active');
            if (mobileMenuBtn) {
                mobileMenuBtn.classList.remove('active');
                const spans = mobileMenuBtn.querySelectorAll('span');
                if (spans && spans.length > 0) {
                    spans[0].style.transform = 'none';
                    if (spans[1]) spans[1].style.opacity = '1';
                    if (spans[2]) spans[2].style.transform = 'none';
                }
            }
        });
    });
}

// Video Modal
function setupVideoModal() {
    const videoBtn = document.querySelector('.video-play-btn');
    
    if (videoBtn) {
        videoBtn.addEventListener('click', function() {
            // Create modal
            const modal = document.createElement('div');
            modal.className = 'video-modal';
            
            // Check if we're on a local file system (which causes postMessage issues)
            const isLocalFile = window.location.protocol === 'file:';
            let videoContent;
            
            if (isLocalFile) {
                // Use a placeholder for local testing to avoid postMessage errors
                videoContent = `
                    <div class="video-placeholder">
                        <div class="placeholder-message">
                            <i class="fas fa-film"></i>
                            <p>Video playback is disabled when viewing locally.</p>
                            <p class="small">Deploy to a web server or use localhost to enable video features.</p>
                        </div>
                    </div>
                `;
            } else {
                // YouTube embed for server environment
                videoContent = `
                    <div class="video-container">
                        <iframe width="560" height="315" src="https://www.youtube.com/embed/VIDEO_ID?autoplay=1" 
                        title="QRL Wallet Video" frameborder="0" 
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                        allowfullscreen></iframe>
                    </div>
                `;
            }
            
            modal.innerHTML = `
                <div class="modal-content">
                    <button class="close-modal">&times;</button>
                    ${videoContent}
                </div>
            `;
            
            document.body.appendChild(modal);
            
            // Prevent body scrolling
            document.body.style.overflow = 'hidden';
            
            // Add animation class
            setTimeout(() => {
                modal.classList.add('active');
            }, 10);
            
            // Close modal functionality
            const closeBtn = modal.querySelector('.close-modal');
            closeBtn.addEventListener('click', closeModal);
            
            modal.addEventListener('click', function(e) {
                if (e.target === modal) {
                    closeModal();
                }
            });
            
            function closeModal() {
                modal.classList.remove('active');
                setTimeout(() => {
                    document.body.removeChild(modal);
                    document.body.style.overflow = 'auto';
                }, 300);
            }
        });
    }
    
    // Add modal styles
    const style = document.createElement('style');
    style.textContent = `
        .video-modal {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: rgba(0, 0, 0, 0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            opacity: 0;
            transition: opacity 0.3s ease;
        }
        
        .video-modal.active {
            opacity: 1;
        }
        
        .modal-content {
            width: 90%;
            max-width: 800px;
            background-color: white;
            border-radius: 8px;
            position: relative;
            transform: scale(0.9);
            transition: transform 0.3s ease;
        }
        
        .video-modal.active .modal-content {
            transform: scale(1);
        }
        
        .close-modal {
            position: absolute;
            top: -40px;
            right: -10px;
            font-size: 30px;
            background: none;
            border: none;
            color: white;
            cursor: pointer;
        }
        
        .video-container, .video-placeholder {
            position: relative;
            padding-bottom: 56.25%; /* 16:9 aspect ratio */
            height: 0;
            overflow: hidden;
            border-radius: 8px;
        }
        
        .video-container iframe {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            border-radius: 8px;
        }
        
        .video-placeholder {
            background-color: #2d2d2d;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 300px;
        }
        
        .placeholder-message {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            text-align: center;
            color: white;
        }
        
        .placeholder-message i {
            font-size: 48px;
            margin-bottom: 20px;
            color: #5e35b1;
        }
        
        .placeholder-message p {
            margin: 10px 0;
            font-weight: 500;
        }
        
        .placeholder-message .small {
            font-size: 14px;
            opacity: 0.7;
        }
    `;
    
    document.head.appendChild(style);
}

// Review Slider
function setupReviewSlider() {
    const reviewsTrack = document.querySelector('.reviews-track');
    const prevBtn = document.querySelector('.slider-arrow.prev');
    const nextBtn = document.querySelector('.slider-arrow.next');
    const reviewCards = document.querySelectorAll('.review-card');
    const tabBtns = document.querySelectorAll('.tab-btn');
    
    if (!reviewsTrack || reviewCards.length === 0) return;
    
    let currentSlide = 0;
    let slideWidth;
    let slidesToShow;
    let maxSlide;
    let currentPlatform = 'android';
    
    // Initial setup
    function initSlider() {
        try {
            // Determine how many slides to show based on screen width
            if (window.innerWidth >= 992) {
                slidesToShow = 3;
            } else if (window.innerWidth >= 768) {
                slidesToShow = 2;
            } else {
                slidesToShow = 1;
            }
            
            // Filter reviews based on current platform
            const filteredReviews = Array.from(reviewCards).filter(card => 
                card.dataset.platform === currentPlatform
            );
            
            maxSlide = Math.max(0, filteredReviews.length - slidesToShow);
            
            // Make sure all reviews are visible but only show the current platform
            reviewCards.forEach(card => {
                card.style.display = card.dataset.platform === currentPlatform ? 'block' : 'none';
            });
            
            // Reset position
            currentSlide = 0;
            updateSliderPosition();
        } catch (err) {
            console.error('Error initializing slider:', err);
        }
    }
    
    function updateSliderPosition() {
        try {
            if (!reviewCards || reviewCards.length === 0) return;
            
            slideWidth = reviewCards[0].offsetWidth + parseInt(window.getComputedStyle(reviewCards[0]).marginRight || '0', 10);
            reviewsTrack.style.transform = `translateX(-${currentSlide * slideWidth}px)`;
        } catch (err) {
            console.error('Error updating slider position:', err);
        }
    }
    
    // Tab functionality
    tabBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            try {
                // Update active tab
                tabBtns.forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                
                // Update current platform
                currentPlatform = this.dataset.platform;
                
                // Reinitialize slider
                initSlider();
            } catch (err) {
                console.error('Error in tab click handler:', err);
            }
        });
    });
    
    // Navigation buttons
    if (prevBtn) {
        prevBtn.addEventListener('click', function() {
            try {
                if (currentSlide > 0) {
                    currentSlide--;
                    updateSliderPosition();
                }
            } catch (err) {
                console.error('Error in prev button handler:', err);
            }
        });
    }
    
    if (nextBtn) {
        nextBtn.addEventListener('click', function() {
            try {
                if (currentSlide < maxSlide) {
                    currentSlide++;
                    updateSliderPosition();
                }
            } catch (err) {
                console.error('Error in next button handler:', err);
            }
        });
    }
    
    // Initialize on load and resize
    window.addEventListener('load', initSlider);
    window.addEventListener('resize', initSlider);
}

// FAQ Accordion
function setupFaqAccordion() {
    const faqItems = document.querySelectorAll('.faq-item');
    
    faqItems.forEach(item => {
        if (!item) return;
        
        const question = item.querySelector('.faq-question');
        if (!question) return;
        
        safeAddEventListener(question, 'click', function() {
            try {
                // Toggle the current item
                item.classList.toggle('active');
                
                // Update the toggle icon
                const toggleIcon = this.querySelector('.toggle-icon');
                if (toggleIcon) {
                    toggleIcon.textContent = item.classList.contains('active') ? '-' : '+';
                }
                
                // Close other items (optional - for accordion effect)
                faqItems.forEach(otherItem => {
                    if (!otherItem || otherItem === item || !otherItem.classList.contains('active')) return;
                    
                    otherItem.classList.remove('active');
                    const otherToggleIcon = otherItem.querySelector('.toggle-icon');
                    if (otherToggleIcon) {
                        otherToggleIcon.textContent = '+';
                    }
                });
            } catch (err) {
                console.error('Error in FAQ accordion handling:', err);
            }
        });
    });
}

// Smooth scrolling for anchor links
function setupSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        if (!anchor) return;
        
        safeAddEventListener(anchor, 'click', function(e) {
            e.preventDefault();
            
            const targetId = this.getAttribute('href');
            
            if (!targetId || targetId === '#') return;
            
            const targetElement = document.querySelector(targetId);
            
            if (targetElement) {
                const offsetTop = targetElement.getBoundingClientRect().top + window.pageYOffset;
                
                window.scrollTo({
                    top: offsetTop,
                    behavior: 'smooth'
                });
            }
        });
    });
}

// Animate elements on scroll
function setupScrollAnimations() {
    try {
        // Add animation styles first
        addAnimationStyles();
        
        // Initialize animations
        const animatedElements = document.querySelectorAll('.animate-on-scroll');
        
        function checkInView() {
            try {
                animatedElements.forEach(element => {
                    if (!element) return;
                    
                    const rect = element.getBoundingClientRect();
                    const elementTop = rect.top;
                    const elementBottom = rect.bottom;
                    
                    // Check if element is in viewport
                    if (elementTop < window.innerHeight && elementBottom > 0) {
                        element.classList.add('visible');
                    }
                });
            } catch (err) {
                console.error('Error checking elements in view:', err);
            }
        }
        
        // Add animation classes to elements
        function initAnimations() {
            try {
                // Sections to animate
                const sections = [
                    '.hero-content', '.hero-image', 
                    '.benefit-card', '.feature-item', 
                    '.review-card', '.stat-item', 
                    '.faq-item'
                ];
                
                sections.forEach((selector, index) => {
                    document.querySelectorAll(selector).forEach((el, i) => {
                        if (!el) return;
                        
                        el.classList.add('animate-on-scroll');
                        // Add different animation delays based on index
                        el.style.transitionDelay = `${i * 0.1}s`;
                    });
                });
                
                // Initial check
                checkInView();
            } catch (err) {
                console.error('Error initializing animations:', err);
            }
        }
        
        // Listen for scroll events with throttling for performance
        let scrollTimeout;
        window.addEventListener('scroll', function() {
            if (scrollTimeout) {
                window.cancelAnimationFrame(scrollTimeout);
            }
            
            scrollTimeout = window.requestAnimationFrame(function() {
                checkInView();
            });
        });
        
        // Initialize animations
        window.addEventListener('load', initAnimations);
    } catch (err) {
        console.error('Error setting up scroll animations:', err);
    }
}

// Add animation styles
function addAnimationStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .animate-on-scroll {
            opacity: 0;
            transform: translateY(20px);
            transition: opacity 0.6s ease, transform 0.6s ease;
        }
        
        .animate-on-scroll.visible {
            opacity: 1;
            transform: translateY(0);
        }
    `;
    
    document.head.appendChild(style);
}

// Initialize all functions when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    try {
        // Detect if we're using file:// protocol
        const isLocalFile = window.location.protocol === 'file:';
        
        if (isLocalFile) {
            // Add a warning banner for local file testing
            const warningBanner = document.createElement('div');
            warningBanner.className = 'local-file-warning';
            warningBanner.innerHTML = `
                <p><strong>Testing Mode:</strong> Some features like video playback may be limited when viewing locally.</p>
                <p>For full functionality, please deploy to a web server or use a local development server.</p>
                <button class="close-warning">×</button>
            `;
            document.body.prepend(warningBanner);
            
            // Allow closing the warning
            const closeBtn = warningBanner.querySelector('.close-warning');
            if (closeBtn) {
                closeBtn.addEventListener('click', function() {
                    warningBanner.style.display = 'none';
                });
            }
            
            // Add warning banner styles
            const style = document.createElement('style');
            style.textContent = `
                .local-file-warning {
                    background-color: #fff3cd;
                    border: 1px solid #ffeeba;
                    color: #856404;
                    padding: 12px 20px;
                    margin-bottom: 0;
                    text-align: center;
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    z-index: 9999;
                    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
                }
                .local-file-warning p {
                    margin: 5px 0;
                }
                .close-warning {
                    position: absolute;
                    right: 10px;
                    top: 10px;
                    background: none;
                    border: none;
                    font-size: 20px;
                    cursor: pointer;
                    color: #856404;
                }
                body {
                    padding-top: ${isLocalFile ? '80px' : '0'};
                }
            `;
            document.head.appendChild(style);
            
            console.info('Running in local file mode. Some features might be limited.');
        }
        
        // Initialize all components with error catching
        setupMobileMenu();
        setupVideoModal();
        setupReviewSlider();
        setupFaqAccordion();
        setupSmoothScroll();
        setupScrollAnimations();
        
    } catch (err) {
        console.error('Error during application initialization:', err);
    }
});

// Function to create a safe event listener with error handling
function safeAddEventListener(element, eventType, handler) {
    if (!element) return;
    
    element.addEventListener(eventType, function(event) {
        try {
            handler.call(this, event);
        } catch (err) {
            console.error(`Error in ${eventType} handler:`, err);
        }
    });
} 