import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import CreditsSection from "../components/CreditsSection";
import img1 from "../Assets/img1.png";
import img2 from "../Assets/img2.png";
import "./Landing.css";

const HERO_IMAGES = [
  { src: img1, alt: "GetPcHealth hardware overview and health grade" },
  { src: img2, alt: "GetPcHealth performance and stress test details" },
];

const DOWNLOAD_URLS = {
  x64: "https://drive.google.com/file/d/1uGL8SOfXPrzMZTeZ63rLRwsaOdnGCtmi/view?usp=sharing",
  universal:
    "https://drive.google.com/file/d/1RQVxHgcrfVxDk8DeNzGYwaEHpE_o2Ork/view?usp=sharing",
};

const NAV_LINKS = [
  ["Who it is for", "#use-cases"],
  ["Features", "#features"],
  ["Diagnostics", "#diagnostics"],
  ["How it works", "#how"],
  ["Pricing", "#credits"],
  ["FAQ", "#faq"],
];

const STATS = [
  ["16", "Diagnostic tabs"],
  ["100%", "Runs on your device"],
  ["100%", "no personal data collected"],
  ["10 & 11", "Windows support"],
];

const AUDIENCES = [
  {
    icon: "tag",
    title: "Buying a used laptop or PC",
    body: "Check true age, battery wear and hidden faults in minutes, before any money changes hands.",
  },
  {
    icon: "store",
    title: "Refurbishers and resellers",
    body: "Verify every unit you take in and ship it with a condition report buyers trust.",
  },
  {
    icon: "wrench",
    title: "Repair benches and technicians",
    body: "Fast, reliable hardware facts without opening the chassis first.",
  },
  {
    icon: "briefcase",
    title: "IT support and procurement",
    body: "Audit machines, validate returns and document condition across a whole fleet.",
  },
  {
    icon: "graduation",
    title: "Students and home users",
    body: "No technical knowledge required. Every reading is explained in plain language.",
  },
  {
    icon: "monitor",
    title: "Anyone selling a machine",
    body: "Show an honest grade instead of arguing about how well the machine was kept.",
  },
];

const FEATURES = [
  {
    icon: "scan",
    title: "Full hardware identity",
    body: "Manufacturer, model, motherboard, BIOS version and serial numbers read straight from the system.",
  },
  {
    icon: "activity",
    title: "Health grade from A to F",
    body: "A score out of 100 built from stability, wear, SMART status and recorded errors.",
  },
  {
    icon: "calendar",
    title: "True age and serial decode",
    body: "Manufacture dates decoded from Dell, HP, Lenovo, ASUS, Acer, MSI, Sony, Samsung, Toshiba and Apple serials.",
  },
  {
    icon: "gauge",
    title: "Real stress tests",
    body: "CPU, GPU and RAM pushed under load to expose throttling, bad memory and failing fans.",
  },
  {
    icon: "shield",
    title: "Tampering and parts audit",
    body: "Flags generic serials, mismatched RAM kits, panels newer than the machine and drives with implausibly low use.",
  },
  {
    icon: "battery",
    title: "Battery and drive wear",
    body: "Wear percentage, cycle count, SMART health, TBW and 4K random I/O latency on a single screen.",
  },
  {
    icon: "file",
    title: "Shareable PDF report",
    body: "Export the complete findings and hand them to a seller, buyer or client.",
  },
  {
    icon: "lock",
    title: "Local and private",
    body: "No account, no telemetry, no cloud analysis. Diagnostics stay on the machine they run on.",
  },
];

const STEPS = [
  {
    title: "Download and run",
    body: "Pick the 64-bit or universal installer. Everything the app needs is bundled with it.",
  },
  {
    title: "Read the hardware",
    body: "Refresh All System Info to get the health grade, the true age estimate and the full component list.",
  },
  {
    title: "Run the live tests",
    body: "Stress the CPU, GPU, RAM and disk to surface problems a spec sheet will never show you.",
  },
  {
    title: "Save the verdict",
    body: "Export a PDF report and use it to negotiate the price, reject the unit or sign it off.",
  },
];

const DIAGNOSTIC_GROUPS = [
  {
    name: "Information",
    tabs: [
      ["All System Info", "Full hardware overview, health grade, true age estimate and network info"],
      ["Battery", "Wear percentage, cycle count, capacity history, live drain monitor and charging circuit test"],
      ["Security", "Secure Boot, TPM, BitLocker, BIOS password status and firmware details"],
      ["Apps List", "Installed applications with one-click uninstall"],
    ],
  },
  {
    name: "Manual Checks",
    tabs: [
      ["Display Test", "Dead pixels, backlight bleed, burn-in and refresh rate on solid colour screens"],
      ["Keyboard Test", "Visual key tester with stuck key detection"],
      ["Audio and Webcam", "Speaker tones, camera preview and microphone level meter"],
      ["USB Ports Check", "Port by port detection of every connected device"],
    ],
  },
  {
    name: "Live Tests",
    tabs: [
      ["Automatic Test", "One guided run through the live checks without clicking between tabs"],
      ["CPU Test", "Single and multi-core benchmark, per-core clocks, temperatures, power and throttling detection"],
      ["GPU Test", "FPS, temperature, clock, utilisation, crash detection and VRAM test"],
      ["RAM Test", "Write and verify pattern test, DDR generation, channel layout and WHEA error count"],
      ["Disk Test", "SMART health, TBW, wear percentage, 4K random I/O latency and partition, BitLocker and RAID scan"],
      ["Burn-in Test", "Extended CPU stress with thermal logging and a live temperature chart"],
      ["VRM Check", "Motherboard voltage rail monitoring in real time"],
    ],
  },
  {
    name: "Physical Inspection",
    tabs: [["Physical Check", "Ports, hinges, screws, charger and cosmetic condition checklist"]],
  },
];

const FAQS = [
  [
    "Do I need to create an account?",
    "No. Download the installer, run it, and the hardware data is yours. There is no sign-up and no login for the desktop app.",
  ],
  [
    "Does any of my hardware data get uploaded?",
    "No. Every diagnostic runs directly on the machine. There is no telemetry, no cloud analysis and no hardware report sent anywhere.",
  ],
  [
    "Which Windows versions are supported?",
    "Windows 10 and Windows 11. Two installers are published: a 64-bit build for most machines and a universal build for every supported version.",
  ],
  [
    "Why does it ask for administrator rights?",
    "Administrator access unlocks the full sensor set: drive SMART wear and temperature counters, hardware monitor voltages and VRM readings. Without it the app still runs, but unavailable readings are honestly shown as N/A instead of being guessed.",
  ],
  [
    "How long does a full check take?",
    "Reading the hardware takes seconds. Each stress and burn-in test runs for a few minutes, so a complete inspection is a short coffee break rather than an afternoon.",
  ],
  [
    "How much does Pro access cost?",
    "Individual access is a one-time purchase locked to one machine. Labs, classrooms and repair benches buy a block of credits and share a single key. Live prices are shown in the pricing section below, payable by UPI.",
  ],
  [
    "Can I share the results with someone else?",
    "Yes. Export the full report as a PDF and send it to a seller, buyer or client. The report is a file on your machine, not a link to an account.",
  ],
  [
    "Is it only for people who know hardware?",
    "No. Every reading is labelled and explained, so a first-time buyer gets the same usable answer as a technician. The physical checklist covers the parts software cannot see, such as hinges, screws and charger condition.",
  ],
];

const ICONS = {
  tag: (
    <>
      <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </>
  ),
  store: (
    <>
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </>
  ),
  wrench: (
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z" />
  ),
  briefcase: (
    <>
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </>
  ),
  graduation: (
    <>
      <path d="M22 10 12 5 2 10l10 5 10-5Z" />
      <path d="M6 12v5c0 1.66 2.69 3 6 3s6-1.34 6-3v-5" />
    </>
  ),
  monitor: (
    <>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </>
  ),
  scan: (
    <>
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <line x1="3" y1="12" x2="21" y2="12" />
    </>
  ),
  activity: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </>
  ),
  gauge: (
    <>
      <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
      <path d="m12 12 4-4" />
    </>
  ),
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />,
  battery: (
    <>
      <rect x="2" y="7" width="16" height="10" rx="2" />
      <line x1="22" y1="11" x2="22" y2="13" />
      <line x1="6" y1="11" x2="6" y2="13" />
      <line x1="10" y1="11" x2="10" y2="13" />
    </>
  ),
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
    </>
  ),
  lock: (
    <>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </>
  ),
  play: <path d="M6 3v18l15-9L6 3Z" />,
  alert: (
    <>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  ),
  check: (
    <>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </>
  ),
  users: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
};

function Icon({ name }) {
  return (
    <svg
      className="ico"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  );
}

function DownloadCard({ fileName, architecture, note, url }) {
  return (
    <a
      className="dl-card"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Download ${fileName}, ${architecture}`}
    >
      <span className="dl-icon">
        <Icon name="download" />
      </span>
      <span className="dl-info">
        <span className="dl-label">Download for Windows</span>
        <span className="dl-title">
          {fileName}
          <span className="dl-arch">{architecture}</span>
        </span>
        <span className="dl-note">{note}</span>
      </span>
    </a>
  );
}

function SectionHead({ eyebrow, title, sub }) {
  return (
    <div className="section-head">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="section-title">{title}</h2>
      {sub ? <p className="section-sub">{sub}</p> : null}
    </div>
  );
}

function Landing({ session }) {
  const navigate = useNavigate();
  const [slide, setSlide] = useState({ current: 0, prev: 0 });
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const previous = document.title;
    document.title = "GetPcHealth - Used PC Hardware Checker for Windows";
    return () => {
      document.title = previous;
    };
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (paused || reducedMotion) return undefined;
    const timer = setInterval(() => {
      setSlide(({ current }) => ({
        prev: current,
        current: (current + 1) % HERO_IMAGES.length,
      }));
    }, 4200);
    return () => clearInterval(timer);
  }, [paused, reducedMotion]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  const goTo = (index) => {
    setSlide(({ current }) => ({
      prev: current,
      current: index % HERO_IMAGES.length,
    }));
  };

  const closeMenu = () => setMenuOpen(false);

  const goApp = (event, path) => {
    event.preventDefault();
    closeMenu();
    navigate(path);
  };

  return (
    <div className="landing">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      <header className={`site-header${scrolled ? " is-scrolled" : ""}`}>
        <nav className="site-nav" aria-label="Main">
          <a className="nav-brand" href="#top" onClick={closeMenu}>
            <img
              src="/assets/GetPcHealth-logo.png"
              alt=""
              width="32"
              height="32"
            />
            <span>GetPcHealth</span>
          </a>

          <div
            id="nav-menu"
            className={`nav-menu${menuOpen ? " is-open" : ""}`}
          >
            {NAV_LINKS.map(([label, href]) => (
              <a key={href} href={href} onClick={closeMenu}>
                {label}
              </a>
            ))}
            {session ? (
              <a
                href="/dashboard"
                className="nav-login"
                onClick={(event) => goApp(event, "/dashboard")}
              >
                Dashboard
              </a>
            ) : null}
            <a
              href="#download"
              className="btn btn-primary nav-cta"
              onClick={closeMenu}
            >
              Download
            </a>
          </div>

          <button
            type="button"
            className="nav-toggle"
            aria-expanded={menuOpen}
            aria-controls="nav-menu"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span />
            <span />
            <span />
          </button>
        </nav>
      </header>

      <main id="main-content">
        <section className="hero" id="top" aria-labelledby="hero-title">
          <div className="hero-grid">
            <div className="hero-copy">
              <p className="hero-badge">
                <span className="hero-badge-dot" />
                Windows 10 and 11 desktop app
              </p>
              <h1 id="hero-title">
                Check all system specs and{" "}
                <span>stress-test</span> <br />
                — all in one App.
              </h1>
              <p className="hero-lede">
                GetPcHealth reads every hardware detail from any Windows laptop
                or desktop — including battery health — then runs live stress
                tests on the CPU, GPU, RAM and disk, so you see how the machine
                actually behaves under load, not just what the spec sheet
                claims.
              </p>

              <div className="hero-actions" id="download">
                <a
                  className="btn btn-primary btn-lg"
                  href={DOWNLOAD_URLS.x64}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Icon name="download" />
                  Download for Windows
                </a>
                <a className="btn btn-ghost btn-lg" href="#diagnostics">
                  See all tests
                </a>
              </div>

              <ul className="hero-trust">
                <li>
                  <Icon name="check" />
                  No account required
                </li>
                <li>
                  <Icon name="check" />
                  Nothing leaves your PC
                </li>
                <li>
                  <Icon name="check" />
                  Report exports to PDF
                </li>
              </ul>
            </div>

            <div className="hero-media">
              <div
                className="hero-slider"
                role="group"
                aria-roledescription="carousel"
                aria-label="GetPcHealth screenshots"
                onMouseEnter={() => setPaused(true)}
                onMouseLeave={() => setPaused(false)}
                onFocusCapture={() => setPaused(true)}
                onBlurCapture={() => setPaused(false)}
              >
                {HERO_IMAGES.map((image, index) => {
                  let className = "hero-slide";
                  if (index === slide.current) className += " active";
                  else if (index === slide.prev) className += " exit";

                  return (
                    <img
                      key={image.src}
                      src={image.src}
                      alt={image.alt}
                      className={className}
                    />
                  );
                })}
              </div>

              <div className="hero-dots">
                {HERO_IMAGES.map((image, index) => (
                  <button
                    key={image.src}
                    type="button"
                    className={`hero-dot${index === slide.current ? " is-active" : ""}`}
                    onClick={() => goTo(index)}
                    aria-label={`Show screenshot ${index + 1}`}
                    aria-current={index === slide.current}
                  />
                ))}
                <span className="hero-caption">
                  {HERO_IMAGES[slide.current].alt}
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="stats" aria-label="GetPcHealth at a glance">
          <div className="wrap">
            <ul className="stat-list">
              {STATS.map(([value, label]) => (
                <li className="stat" key={label}>
                  <span className="stat-value">{value}</span>
                  <span className="stat-label">{label}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="use-cases">
          <SectionHead
            eyebrow="Who it is for"
            sub="Anyone who needs to know what a Windows machine is really worth before they commit to it."
          />
          <div className="card-grid">
            {AUDIENCES.map((item) => (
              <article className="card" key={item.title}>
                <span className="card-icon">
                  <Icon name={item.icon} />
                </span>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="features">
          <SectionHead
            eyebrow="Capabilities"
            title="Everything a spec sheet hides"
            sub="Hardware level data, read from the machine itself, instead of seller claims."
          />
          <div className="card-grid card-grid-4">
            {FEATURES.map((item) => (
              <article className="card card-compact" key={item.title}>
                <span className="card-icon">
                  <Icon name={item.icon} />
                </span>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="how">
          <SectionHead
            eyebrow="How it works"
            title="From download to verdict in four steps"
            sub="No setup, no configuration files, no waiting on an upload."
          />
          <ol className="steps">
            {STEPS.map((step, index) => (
              <li className="step" key={step.title}>
                <span className="step-num">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section id="diagnostics">
          <SectionHead
            eyebrow="Diagnostics"
            title="16 tabs, grouped the way you work"
            sub="Information you read once, checks you run yourself, and live tests that push the hardware."
          />
          <div className="diag-grid">
            {DIAGNOSTIC_GROUPS.map((group) => (
              <article className="diag-group" key={group.name}>
                <header className="diag-head">
                  <h3>{group.name}</h3>
                  <span className="diag-count">{group.tabs.length}</span>
                </header>
                <dl className="diag-list">
                  {group.tabs.map(([name, detail]) => (
                    <div className="diag-item" key={name}>
                      <dt>{name}</dt>
                      <dd>{detail}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </div>
        </section>

      

        <CreditsSection />

        <section id="privacy">
          <div className="privacy-box">
            <span className="privacy-icon">
              <Icon name="lock" />
            </span>
            <div>
              <h2>100% local and private</h2>
              <p>
                No hardware data is sent anywhere. Every diagnostic runs
                directly on the machine, with no telemetry, no cloud analysis
                and no account needed to read your own device.
              </p>
            </div>
          </div>
        </section>

        <section id="faq">
          <SectionHead
            eyebrow="FAQ"
            title="Questions worth asking first"
            sub="The practical details people check before downloading a diagnostic tool."
          />
          <div className="faq-list">
            {FAQS.map(([question, answer]) => (
              <details className="faq-item" key={question}>
                <summary>
                  <span>{question}</span>
                  <span className="faq-mark" aria-hidden="true" />
                </summary>
                <div className="faq-answer">
                  <p>{answer}</p>
                </div>
              </details>
            ))}
          </div>
          <p className="faq-contact">
            Still have a question? Email{" "}
            <a href="mailto:getpchealth@gmail.com">getpchealth@gmail.com</a> —
            we usually reply within a day.
          </p>
        </section>

        <section id="about">
          <div className="about-grid">
            <div className="about-text">
              <p className="eyebrow">About</p>
              <h2>Built for the question every used-hardware buyer asks</h2>
              <p>
                Buying a used PC or laptop is a gamble. GetPcHealth exists so
                that anyone, from a student to a reseller, can run one
                comprehensive check and get an honest answer about the real
                condition of the hardware.
              </p>
              <p>
                Everything runs on the machine in front of you. There is no
                cloud analysis, no account to create and no data collected
                while you work.
              </p>
            </div>
            <ul className="about-values">
              <li>
                <span className="about-val-icon">
                  <Icon name="shield" />
                </span>
                <div>
                  <h3>Privacy first</h3>
                  <p>All diagnostics run on the device.</p>
                </div>
              </li>
              <li>
                <span className="about-val-icon">
                  <Icon name="activity" />
                </span>
                <div>
                  <h3>Data driven</h3>
                  <p>Hardware level readings, not guesses.</p>
                </div>
              </li>
              <li>
                <span className="about-val-icon">
                  <Icon name="gauge" />
                </span>
                <div>
                  <h3>Deep testing</h3>
                  <p>Real load tests reveal hidden problems.</p>
                </div>
              </li>
              <li>
                <span className="about-val-icon">
                  <Icon name="monitor" />
                </span>
                <div>
                  <h3>Windows only</h3>
                  <p>Focused support for Windows 10 and 11.</p>
                </div>
              </li>
            </ul>
          </div>
        </section>

        <section className="cta" aria-labelledby="cta-title">
          <div className="wrap">
            <p className="eyebrow">Ready when you are</p>
            <h2 id="cta-title">Inspect the machine before you pay for it</h2>
            <p className="cta-sub">
              Run GetPcHealth on any Windows PC or laptop and get a full report
              in minutes.
            </p>
            <div className="dl-row">
              <DownloadCard
                fileName="GetPcHealth-1.0.0-x64.exe"
                architecture="64-bit"
                note="Recommended for most PCs"
                url={DOWNLOAD_URLS.x64}
              />
              <DownloadCard
                fileName="GetPcHealth-1.0.0-setup.exe"
                architecture="Universal"
                note="Windows 10 and 11, every supported version"
                url={DOWNLOAD_URLS.universal}
              />
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="wrap footer-top">
          <div className="footer-brand">
            <img src="/assets/GetPcHealth-logo.png" alt="" width="34" height="34" />
            <strong>GetPcHealth</strong>
            <p>
              Used PC hardware checker for Windows. Read, test and grade a
              machine entirely on device.
            </p>
          </div>
          <nav className="footer-cols" aria-label="Footer">
            <div className="footer-col">
              <h3>Product</h3>
              <a href="#features">Features</a>
              <a href="#diagnostics">Diagnostics</a>
              <a href="#how">How it works</a>
              <a href="#download">Download</a>
            </div>
            <div className="footer-col">
              <h3>Buyers</h3>
              <a href="#use-cases">Who it is for</a>
              <a href="#red-flags">Red flags</a>
              <a href="#faq">FAQ</a>
            </div>
            <div className="footer-col">
              <h3>Access</h3>
              <a href="#credits">Pricing</a>
              <a href="#privacy">Privacy</a>
              <a href="#about">About</a>
            </div>
          </nav>
        </div>
        <div className="wrap footer-bottom">
          <p>&copy; {new Date().getFullYear()} GetPcHealth</p>
          <p className="footer-mail">
            Customer care: <a href="mailto:getpchealth@gmail.com">getpchealth@gmail.com</a>
          </p>
          <p>No data collected &middot; Windows 10 and 11</p>
        </div>
      </footer>
    </div>
  );
}

export default Landing;
