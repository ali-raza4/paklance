/* ===== PAKLANCE BLOG: JS START =====
   Frontend-only Blog for Paklance.
   Routes in this preview use the hash; on the live site map them to real paths:
     #blog            →  /blog
     #blog/<slug>     →  /blog/<slug>
   Components (each returns HTML): BlogHero, BlogSearch, BlogCategories, FeaturedArticle, BlogCard, BlogGrid,
     PopularReads, EmptyState, NewsletterSignup, ArticleHeader, ShareButtons, ArticleContent,
     TableOfContents, AuthorCard, RelatedArticles, Cover.
   Articles follow this data shape:
     { slug, title, excerpt, category, tags[], date 'YYYY-MM-DD', updated?, featured?, popular?, body[] }
   body blocks: ['p',text] ['h2',text] ['h3',text] ['ul',[items]] ['ol',[items],start?] ['tip',title,text]
                ['quote',text] ['table',[head],[[row]]] ['img',caption]   (**bold** allowed in text)
                ['video',caption,url]  YouTube / Vimeo / Loom / Google Drive link; an empty url shows “Video guide coming soon”
*/
window.PaklanceBlog = (function () {
  'use strict';

  var SITE = 'https://www.paklance.com';
  var CATEGORIES = ['All', 'Freelancing', 'Career & Skills', 'Hiring', 'Global Hiring', 'Remote Work', 'Business', 'Productivity', 'Technology', 'Finance & Payments', 'Talent Management', 'Paklance Updates'];
  var CAT_STYLE = {
    'Freelancing':        { bg: '#0A5C2E', fg: '#9FD8B5', icon: 'user-check' },
    'Career & Skills':    { bg: '#E3F0E7', fg: '#01411C', icon: 'sparkle' },
    'Hiring':             { bg: '#01411C', fg: '#F2C46B', icon: 'search' },
    'Global Hiring':      { bg: '#12804A', fg: '#F1F7F3', icon: 'globe' },
    'Remote Work':        { bg: '#F1F6F2', fg: '#12804A', icon: 'home' },
    'Business':           { bg: '#1E3B2C', fg: '#CFE6D7', icon: 'contract' },
    'Productivity':       { bg: '#FFF3D9', fg: '#7E4E00', icon: 'clock' },
    'Technology':         { bg: '#0E1B14', fg: '#3FB97A', icon: 'code' },
    'Finance & Payments': { bg: '#01411C', fg: '#9FD8B5', icon: 'wallet' },
    'Talent Management':  { bg: '#DCEBE1', fg: '#0A5C2E', icon: 'users' },
    'Paklance Updates':   { bg: '#0A5C2E', fg: '#FFF3D9', icon: 'megaphone' }
  };
  var AUTHOR = { name: 'Paklance Editorial Team', initials: 'PE', bio: 'Practical guides for freelancers, businesses and global teams working with Pakistani talent.' };

  /* ---------------- ARTICLES ---------------- */
  var ARTICLES = [
    {
      // The video guide for recording a profile video. Paste the tutorial's YouTube/Vimeo link into the 'video' block once it's recorded.
      slug: 'how-to-record-your-video-introduction', category: 'Freelancing', date: '2026-09-24',
      title: 'How to Record Your Video Introduction',
      excerpt: 'A step-by-step guide to recording a short, confident profile video with just your phone.',
      tags: ['video introduction', 'profile', 'freelancing', 'getting hired', 'tips'],
      takeaways: ['Keep it to 10–15 seconds and follow a simple five-part script.', 'Good light and a quiet room matter more than an expensive camera.', 'Upload the file or paste a link from your dashboard, and it plays on your profile.'],
      cta: { title: 'Ready to record yours?', text: 'Add your video introduction and it plays at the top of your profile.', button: 'Add your video introduction', action: 'video' },
      body: [
        ['p', 'A short video on your profile lets clients see and hear you before they hire you. It shows how you communicate, which is often what decides between two similar profiles. You don’t need a camera or editing software: a phone and 20 minutes are enough.'],
        ['video', 'Video guide: recording your introduction on a phone', ''],
        ['h2', 'What to say in 10–15 seconds'],
        ['ol', ['**Hello and your name:** say where you’re based, for example “I’m Sana, a brand designer in Lahore.”', '**What you do and for whom:** one sentence about the work you do and the clients you do it for.', '**One result you’re proud of:** a real project and what changed for the client.', '**How you work:** your working hours, how you keep clients updated and the tools you use.', '**Invite them to reach out:** end with a friendly line such as “Send me a message with your project.”']],
        ['tip', 'Write it down first', 'Write your script, read it aloud twice, then record without reading it word for word. It sounds more natural when you speak from notes.'],
        ['h2', 'Set up in five minutes'],
        ['ul', ['**Light:** face a window or a lamp. Avoid having a bright window behind you.', '**Sound:** choose a quiet room; soft furnishings reduce echo. Wired earphones with a mic help.', '**Framing:** hold your phone sideways, at eye level, with your head and shoulders in the frame.', '**Background:** tidy and simple. A plain wall or a bookshelf works well.', '**Test:** record 10 seconds and play it back to check light and sound.']],
        ['checklist', 'Ready to record?', ['I’ve written my script and read it aloud twice', 'I’m facing a window or a lamp', 'The room is quiet', 'My phone is sideways, at eye level', 'I’ve recorded a 10-second test and played it back'], 'You’re ready to record. Do three or four takes and keep the best one.'],
        ['h2', 'Record and choose your best take'],
        ['p', 'Record three or four takes and pick the one where you sound most relaxed. Small pauses are fine. Smile at the start and look at the camera lens, not at your own image on the screen.'],
        ['h2', 'Upload it and add it to your profile'],
        ['ol', ['On your Paklance dashboard, open **Video introduction** and choose **Add video**.', 'Choose **Upload from device** and pick the video from your phone or computer. MP4, MOV and WebM files up to 100 MB and 3 minutes work.', 'Prefer a link? Upload it to YouTube (choose **Unlisted**), Vimeo, Loom or Google Drive (set sharing to **Anyone with the link**), then choose **Paste a link** instead.']],
        ['h2', 'Prefer help in person?'],
        ['p', 'Paklance runs free seminars, online and in person, where our team helps you plan what to say and record your video. You can see the upcoming dates and register from the **Video introduction** card on your dashboard.']
      ]
    },
    {
      slug: 'introducing-the-new-paklance-sign-up', category: 'Paklance Updates', date: '2026-09-22',
      takeaways: ['Sign up with Google or email on one screen.', 'Email sign-ups are confirmed with a 6-digit code.', 'Add your name and skills, and matching jobs appear on your dashboard.'],
      title: 'Introducing the New Paklance Sign-Up',
      excerpt: 'A faster way to join Paklance with Google or email, plus a short setup that helps match you with the right work.',
      tags: ['paklance', 'sign up', 'account', 'update', 'onboarding'],
      body: [
        ['p', 'We’ve redesigned how you join Paklance. The new sign-up is quicker, works with Google or email, and helps us understand your skills from the very first day.'],
        ['h2', 'What’s new'],
        ['ul', ['**Google or email on one screen:** choose whichever is easier for you.', '**Email verification:** email sign-ups are confirmed with a 6-digit code.', '**Your name and skills:** a short setup so clients see the real you.', '**Straight to your dashboard:** see work that matches your skills as soon as you finish.']],
        ['h2', 'Why we ask for your skills'],
        ['p', 'Your skills help us show you relevant jobs and help clients find you. You can pick from popular skills or add your own, and you can edit them at any time from your dashboard.'],
        ['tip', 'Already have an account?', 'Just log in as usual. If your profile is missing your name or skills, we’ll ask you to add them the next time you sign in.'],
        ['h2', 'What’s next'],
        ['p', 'We’re working on more ways to build your profile, including headlines, bios and portfolios. We’ll share updates here on the blog.']
      ]
    },
    {
      slug: 'how-to-build-a-high-performing-remote-team', category: 'Global Hiring', date: '2026-09-21', updated: '2026-09-23', featured: true,
      takeaways: ['Hire for communication and ownership, not just skills.', 'Agree working hours that overlap, and write decisions down.', 'Use milestones so progress and payment stay visible.'],
      title: 'How to Build a High-Performing Remote Team',
      excerpt: 'Learn practical ways businesses can find, manage, and collaborate with talent across borders.',
      tags: ['remote team', 'remote work', 'global hiring', 'management', 'collaboration', 'culture'],
      body: [
        ['p', 'A remote team can be as effective as any office team, and sometimes more so. But it rarely happens by accident. High-performing remote teams are built on clear roles, good written communication and routines that everyone understands.'],
        ['h2', 'Hire for communication as well as skill'],
        ['p', 'Technical ability matters, but in a remote team, how someone communicates matters just as much. During hiring, pay attention to how clearly candidates write, how they ask questions and how they explain their work.'],
        ['ul', ['Review written answers, not only calls.', 'Ask candidates to explain a past project step by step.', 'Notice whether they confirm details or make assumptions.']],
        ['h2', 'Design the team’s working hours'],
        ['p', 'When people work across time zones, decide which hours are shared and which are for focused work. A few overlapping hours are usually enough for meetings and quick decisions.'],
        ['img', 'A simple overlap plan: shared hours for meetings, and the rest of the day for focused work.'],
        ['h2', 'Give every task a clear owner'],
        ['p', 'In an office, it’s easy to lean over and ask who is handling something. Remotely, unclear ownership causes delays. Make sure every project, task and decision has one named owner.'],
        ['ul', ['One owner per task, even when several people contribute.', 'A due date that includes the time zone.', 'A single place where the status is always up to date.']],
        ['h2', 'Build a written culture'],
        ['p', 'Write down decisions, processes and project context so people can find answers without waiting for a meeting. This also makes onboarding new team members much faster.'],
        ['tip', 'Default to writing', 'Before scheduling a call, ask whether a clear written message would do. Save meetings for discussions that genuinely need them.'],
        ['h2', 'Run simple, regular check-ins'],
        ['ol', ['**Start of the week:** everyone shares their main priorities.', '**Mid-week:** a short written update on progress and blockers.', '**End of the week:** review what was delivered and what was learned.']],
        ['h2', 'Protect trust with a fair process'],
        ['p', 'Clear contracts, milestone-based payments and prompt feedback help everyone feel secure. When people know what is expected and how they’ll be paid, they can focus on doing great work.'],
        ['quote', 'Remote teams don’t need more meetings. They need clearer expectations and faster feedback.'],
        ['h2', 'Review and improve'],
        ['p', 'Every few months, ask the team what is working and what isn’t. Small changes to meetings, tools or processes can make a big difference over time.']
      ]
    },
    {
      slug: 'how-to-build-a-freelance-profile', category: 'Freelancing', date: '2026-09-18', popular: true,
      title: 'How to Build a Freelance Profile That Gets Noticed',
      excerpt: 'Practical ways to present your skills, experience, and portfolio professionally.',
      tags: ['profile', 'portfolio', 'freelancing', 'personal brand', 'clients'],
      takeaways: ['Use a specific headline that names your service and the clients you serve.', 'Show proof: a few relevant portfolio pieces beat a list of adjectives.', 'List the skills clients search for, and review your profile every few months.'],
      body: [
        ['p', 'Your profile is often the first thing a client sees, sometimes even before your proposal. A clear, specific profile helps the right clients understand what you do and why they can trust you with their project.'],
        ['h2', 'Start with a specific headline'],
        ['p', 'A headline like “Graphic Designer” describes thousands of people. A headline like “Brand identity and packaging designer for food and retail brands” tells a client exactly where you fit.'],
        ['ul', ['Name the service you deliver, not just your job title.', 'Mention the type of client or industry you know best.', 'Keep it short enough to read at a glance.']],
        ['h2', 'Write a summary that answers the client’s questions'],
        ['p', 'Clients scan profiles quickly. Use your summary to answer three questions: what problems you solve, how you work, and what the client will have at the end.'],
        ['ol', ['Open with the outcome you deliver.', 'Explain your process in two or three sentences.', 'Close with how you communicate and when you’re available.']],
        ['tip', 'Write for one reader', 'Picture a single ideal client while you write. Profiles written for “everyone” tend to sound generic and forgettable.'],
        ['h2', 'Show proof, not adjectives'],
        ['p', 'Words like “passionate” and “hard-working” are easy to claim and hard to check. Replace them with evidence: portfolio pieces, before-and-after examples, or a short description of a problem you solved.'],
        ['h3', 'Choose portfolio pieces carefully'],
        ['p', 'Three strong, relevant projects usually say more than twenty unrelated ones. For each piece, add one or two lines about the brief, your role and the result.'],
        ['h2', 'List the skills clients search for'],
        ['p', 'Add the specific tools and skills a client might type into a search box, such as **Figma**, **Shopify** or **SEO writing**. Keep the list focused on the work you want more of.'],
        ['quote', 'A good profile doesn’t try to impress everyone. It makes the right client think, “This person understands my project.”'],
        ['checklist', 'Check your profile', ['My headline names my service and the clients I work with', 'My summary says what I deliver and how I work', 'I’ve added three strong, relevant portfolio pieces', 'My skills match the work I want more of', 'My availability is up to date'], 'Your profile is ready for clients to find.'],
        ['h2', 'Keep it up to date'],
        ['p', 'Review your profile every few months. Replace older samples with recent work, update your availability, and remove skills you no longer want to be hired for.']
      ]
    },
    {
      slug: 'how-businesses-can-hire-remote-talent', category: 'Hiring', date: '2026-09-15', popular: true,
      title: 'How Businesses Can Hire Remote Talent Effectively',
      excerpt: 'A step-by-step approach to defining the role, shortlisting well and starting remote work on the right foot.',
      tags: ['hiring', 'remote talent', 'remote work', 'recruitment', 'freelancers', 'shortlist'],
      takeaways: ['Write down what “done” looks like before you write the job post.', 'Include the budget, timeline and working hours so the right people apply.', 'Start with a small first milestone and agree a regular check-in.'],
      body: [
        ['p', 'Hiring remotely gives you access to a much wider pool of skills. It also means you can’t rely on a quick chat at someone’s desk to clear up confusion, so a little extra structure at the start saves a lot of time later.'],
        ['h2', 'Define the outcome before the role'],
        ['p', 'Before writing a job post, write down what “done” looks like. A clear outcome helps you judge candidates, and it helps them decide whether they’re a good fit.'],
        ['ul', ['What will be delivered, and by when?', 'Which decisions can the specialist make on their own?', 'How will you review and approve the work?']],
        ['h2', 'Write a job post that filters for fit'],
        ['p', 'Include the budget range, the timeline, the tools you use and your working hours. Specific posts attract fewer but more relevant applications.'],
        ['tip', 'Ask one screening question', 'A short question about the project, such as “How would you approach the first week?”, quickly shows who has actually read your brief.'],
        ['checklist', 'Before you post the job', ['I’ve written down what “done” looks like', 'The post includes a budget range and a timeline', 'I’ve listed the tools we use and our working hours', 'I’ve added one screening question'], 'Your job post is ready to go.'],
        ['h2', 'Shortlist on evidence'],
        ['p', 'Compare candidates on relevant samples and on how clearly they communicate, not only on price. For larger projects, a small paid test task can help, as long as it is clearly scoped.'],
        ['h2', 'Start with a clear first milestone'],
        ['p', 'Break the work into milestones, each with a deliverable and a payment. Keep the first milestone small so trust can build quickly on both sides.'],
        ['ol', ['Agree the scope and the first deliverable.', 'Fund the milestone so the specialist knows payment is secured.', 'Review the work, share feedback and approve.']],
        ['h2', 'Communicate on a rhythm'],
        ['p', 'Agree how often you’ll check in and where. For many teams, a short weekly call plus written updates in one shared place works well.']
      ]
    },
    {
      slug: 'working-with-international-clients', category: 'Remote Work', date: '2026-09-10',
      title: 'A Practical Guide to Working With International Clients',
      excerpt: 'How to handle communication, time zones, expectations and payments when your clients are in other countries.',
      tags: ['international clients', 'communication', 'remote work', 'time zones', 'contracts'],
      takeaways: ['Confirm scope, revisions, deadlines and time zone in writing before you start.', 'Share your hours in both time zones and agree a regular overlap window.', 'Agree the currency and milestone payments up front.'],
      body: [
        ['p', 'Working with clients in other countries can open up interesting projects and steady work. It also brings new challenges: different time zones, communication styles and expectations. A few simple habits make a big difference.'],
        ['h2', 'Put expectations in writing'],
        ['p', 'Before you start, confirm the details in a short written summary that you can both refer back to.'],
        ['ul', ['The scope of work and what is not included.', 'How many rounds of revisions are included.', 'Deadlines, including the time zone they refer to.', 'Where you’ll communicate, and how quickly you’ll usually reply.']],
        ['h2', 'Communicate clearly across cultures'],
        ['p', 'Be polite, direct and specific. If something in a brief is unclear, ask. It’s better to confirm an assumption than to deliver the wrong thing.'],
        ['tip', 'Summarise every call', 'After a meeting, send three or four bullet points covering what was agreed and what happens next. It prevents misunderstandings and shows you’re organised.'],
        ['h2', 'Plan around time zones'],
        ['p', 'Share your working hours in both your time zone and your client’s. Agree a regular overlap window for quick questions, and use the rest of your day for focused work.'],
        ['h2', 'Agree payment terms up front'],
        ['p', 'Confirm the currency, the amount for each milestone and what happens if the scope changes. Milestone-based payments help both sides: the client pays as work is approved, and you know each stage is funded.'],
        ['h2', 'Deliver like a partner'],
        ['p', 'Share progress before you’re asked, flag risks early and suggest improvements when you see them. Clients remember the people who made their project easier.']
      ]
    },
    {
      slug: 'skills-that-help-freelancers-stand-out', category: 'Career & Skills', date: '2026-09-08', popular: true,
      title: '10 Skills That Can Help Freelancers Stand Out',
      excerpt: 'The technical and professional skills that make clients more confident hiring you, and how to build them.',
      tags: ['skills', 'career', 'communication', 'freelancing', 'growth'],
      takeaways: ['Communication, planning and reliability often decide who gets hired again.', 'Build depth in one core tool, and learn to explain your choices.', 'Start with the two skills that would help your current clients most.'],
      body: [
        ['p', 'Technical skill gets you considered. The skills around it, such as communication, planning and reliability, are often what gets you hired again. Here are ten worth building.'],
        ['h2', 'Professional skills'],
        ['ol', ['**Clear written communication.** Short, structured messages save everyone time.', '**Scoping and estimating.** Break work into parts and estimate each one honestly.', '**Time management.** Plan your week and protect time for focused work.', '**Handling feedback.** Ask questions, separate opinions from requirements, and respond calmly.', '**Problem framing.** Restate the client’s goal before proposing a solution.']],
        ['h2', 'Technical and business skills'],
        ['ol', ['**Depth in one core tool.** Be genuinely strong in the main tool of your field.', '**Basic project management.** Track tasks, deadlines and decisions in one place.', '**Presenting your work.** Explain your choices, not just the final result.', '**Understanding the client’s business.** Know who their customers are and what success means to them.', '**Learning quickly.** Pick up new tools and topics when a project needs them.'], 6],
        ['tip', 'Pick two to start', 'You don’t need to work on all ten at once. Choose the two that would help your current clients most and focus on them for a month.'],
        ['h2', 'How to build these skills'],
        ['ul', ['Take on small projects slightly outside your comfort zone.', 'Ask clients what went well and what could be better.', 'Keep short notes on what you learn from each project.', 'Study how experienced people in your field present their work.']]
      ]
    },
    {
      slug: 'how-to-write-a-better-freelance-proposal', category: 'Freelancing', date: '2026-09-03', updated: '2026-09-12', popular: true,
      title: 'How to Write a Better Freelance Proposal',
      excerpt: 'A simple structure for proposals that show you understand the brief and make it easy for clients to say yes.',
      tags: ['proposal', 'applying', 'clients', 'freelancing', 'writing'],
      takeaways: ['Open by restating the client’s goal in your own words.', 'Cover your approach, one relevant example, milestones, price and a next step.', 'Keep it short enough to read in a minute, and follow up only once.'],
      body: [
        ['p', 'A proposal is your chance to show a client that you understand their project. The best proposals are short, specific and easy to say yes to.'],
        ['h2', 'Lead with the client’s goal'],
        ['p', 'Open by restating what the client is trying to achieve, in your own words. It shows you’ve read the brief and immediately sets you apart from generic applications.'],
        ['h2', 'A simple structure that works'],
        ['ol', ['**The goal:** one or two sentences on what the client needs.', '**Your approach:** how you would tackle the work.', '**A relevant example:** one project similar to theirs.', '**Timeline and milestones:** what you’ll deliver, and when.', '**Price:** what is included, and what isn’t.', '**A next step:** a question or a suggested call.']],
        ['tip', 'Keep it short', 'If a client can’t understand your proposal in a minute, it’s probably too long. Put the most important information first.'],
        ['checklist', 'Before you send it', ['It opens with the client’s goal', 'It includes one project similar to theirs', 'The milestones and timeline are clear', 'The price says what’s included and what isn’t', 'It ends with a question or a next step'], 'Your proposal is ready to send.'],
        ['h2', 'Common mistakes to avoid'],
        ['ul', ['Copying and pasting the same proposal for every job.', 'Talking only about yourself instead of the project.', 'Giving a vague price with no breakdown.', 'Ending without a clear next step.']],
        ['quote', 'Clients don’t hire the longest proposal. They hire the one that makes the next step feel obvious.'],
        ['h2', 'Follow up once'],
        ['p', 'If you haven’t heard back after a few days, a short, polite follow-up is fine. After that, move on and put your energy into the next opportunity.']
      ]
    },
    {
      slug: 'managing-projects-across-time-zones', category: 'Productivity', date: '2026-08-28',
      title: 'How to Manage Projects Across Multiple Time Zones',
      excerpt: 'Simple routines for keeping projects moving when your team and clients are spread across the world.',
      tags: ['time zones', 'project management', 'productivity', 'remote work', 'scheduling'],
      takeaways: ['Map everyone’s hours and agree a few overlap hours for live questions.', 'End each day with a short written handover.', 'Keep one shared source of truth, and always write the time zone, such as “5:00 PM PKT”.'],
      body: [
        ['p', 'When your team or clients are spread across the world, the working day never quite lines up. With a few simple routines, time zones can even become an advantage: work keeps moving while someone else is offline.'],
        ['h2', 'Find your overlap hours'],
        ['p', 'Start by mapping when each person is available. The table below shows what a client’s 9:00 AM looks like in Pakistan Standard Time (PKT, UTC+5).'],
        ['table', ['Client location', 'Their time', 'Time in Pakistan (PKT)'], [['United Kingdom (winter, GMT)', '9:00 AM', '2:00 PM'], ['United Kingdom (summer, BST)', '9:00 AM', '1:00 PM'], ['United Arab Emirates (GST)', '9:00 AM', '10:00 AM'], ['US East Coast (winter, EST)', '9:00 AM', '7:00 PM'], ['US East Coast (summer, EDT)', '9:00 AM', '6:00 PM']]],
        ['tip', 'Watch for daylight saving time', 'Pakistan doesn’t change its clocks, but the UK and US do. Check your overlap hours again whenever their clocks change.'],
        ['h2', 'Make handovers asynchronous'],
        ['p', 'Instead of waiting for a meeting, end each day with a short written handover so the next person can continue straight away.'],
        ['ul', ['What you finished today.', 'What is still in progress.', 'Any questions or blockers, and who they’re for.']],
        ['h2', 'Keep one source of truth'],
        ['p', 'Use one shared task board or document for status, files and decisions. When information lives in private chats, people in other time zones miss it.'],
        ['h2', 'Always write the time zone'],
        ['p', '“Friday at 5” can mean very different things. Write deadlines with the time zone included, such as “Friday, 5:00 PM PKT”, and confirm them in writing.']
      ]
    },
    {
      slug: 'freelancer-vs-full-time-hire', category: 'Talent Management', date: '2026-08-24',
      title: 'Freelancer vs Full-Time Hire: Which Is Right for Your Team?',
      excerpt: 'A clear comparison to help you decide when to bring in a freelancer and when a full-time role makes more sense.',
      tags: ['freelancer', 'full-time', 'hiring', 'talent management', 'cost', 'business'],
      takeaways: ['Freelancers suit defined projects, specialist skills and uneven workloads.', 'Full-time hires suit ongoing work that needs deep knowledge of your business.', 'Many teams combine a small full-time core with trusted freelancers.'],
      body: [
        ['p', 'Should you bring in a freelancer or hire someone full-time? The right answer depends on the work, your timeline and how the role fits into your long-term plans.'],
        ['h2', 'A quick comparison'],
        ['table', ['Factor', 'Freelancer', 'Full-time hire'], [['Commitment', 'Project-based or part-time', 'Ongoing'], ['Speed to start', 'Often within days', 'Often several weeks'], ['Cost structure', 'Paid per project, milestone or hour', 'Salary, benefits and overheads'], ['Management style', 'Focused on outcomes and deliverables', 'Ongoing development and integration'], ['Best for', 'Specialist or short-term work', 'Core, long-term responsibilities']]],
        ['h2', 'When a freelancer makes sense'],
        ['ul', ['You need a specialist skill for a defined project.', 'The workload is uneven or seasonal.', 'You want to test a new area before committing to a permanent role.', 'You need someone to start quickly.']],
        ['h2', 'When a full-time hire makes sense'],
        ['ul', ['The work is central to your business and ongoing.', 'The role needs deep knowledge of your product or customers.', 'You want to build the skill inside your team over time.']],
        ['tip', 'Consider a hybrid', 'Many teams keep a small full-time core and work with trusted freelancers for specialist or overflow work. It keeps the team flexible without losing continuity.'],
        ['h2', 'Questions to ask before deciding'],
        ['ol', ['Is this work ongoing, or does it have a clear end?', 'How much company knowledge does the role need?', 'How quickly do you need someone to start?', 'Who will manage the work day to day?']]
      ]
    },
    {
      slug: 'portfolio-that-shows-your-value', category: 'Career & Skills', date: '2026-08-20',
      title: 'How to Create a Portfolio That Shows Your Value',
      excerpt: 'Turn your past work into clear case studies that help clients picture what you can do for them.',
      tags: ['portfolio', 'case study', 'career', 'freelancing', 'design'],
      takeaways: ['Pick a few projects that match the work you want more of.', 'For each one, explain the brief, your role, your process and the result.', 'Ask permission before sharing client work, and remove confidential details.'],
      body: [
        ['p', 'A portfolio isn’t just a gallery of your best work. It’s a way to help clients picture what you could do for them. The strongest portfolios explain the thinking behind each project, not only the final result.'],
        ['h2', 'Choose quality over quantity'],
        ['p', 'Pick a small number of projects that match the work you want more of. Remove pieces that no longer represent your skills, even if you’re proud of them.'],
        ['h2', 'Tell the story of each project'],
        ['ol', ['**The brief:** what the client needed and why.', '**Your role:** what you were responsible for.', '**The process:** the key decisions you made along the way.', '**The result:** what was delivered and how the client used it.']],
        ['img', 'Each portfolio entry works best as a short story: the brief, your process and the result.'],
        ['tip', 'No client work yet?', 'Create self-initiated projects based on realistic briefs, and label them clearly as personal projects. They still show your skills and your process.'],
        ['h2', 'Make it easy to scan'],
        ['ul', ['Lead each project with a strong image or summary.', 'Use short headings and brief paragraphs.', 'Put the most relevant project first.']],
        ['h2', 'Respect client confidentiality'],
        ['p', 'Ask for permission before sharing client work, and remove any confidential details. If you can’t share a project, describe the challenge and your approach in general terms instead.']
      ]
    },
    {
      slug: 'fundamentals-of-global-hiring', category: 'Global Hiring', date: '2026-08-14',
      title: 'The Fundamentals of Global Hiring',
      excerpt: 'What businesses should think about before hiring talent in another country, from contracts to communication.',
      tags: ['global hiring', 'contracts', 'remote team', 'international', 'onboarding'],
      takeaways: ['Choose the right model: project specialist, dedicated resource or project team.', 'Put scope, IP ownership, confidentiality and payment terms in the contract.', 'Onboard properly, and measure outcomes rather than hours online.'],
      body: [
        ['p', 'Hiring talent in another country can give your business access to specialist skills and more flexible teams. Getting the basics right from the start makes the experience smoother for everyone.'],
        ['h2', 'Choose the right engagement model'],
        ['ul', ['**Project specialist:** one professional for a defined project with clear milestones.', '**Dedicated resource:** a professional who works consistently with your team over months.', '**Curated project team:** several specialists working together on one brief.']],
        ['h2', 'Get the contract right'],
        ['p', 'A clear contract protects both sides. At a minimum, it should cover:'],
        ['ul', ['The scope of work and deliverables.', 'Ownership of intellectual property.', 'Confidentiality and, where needed, an NDA.', 'Payment amounts, schedule and currency.', 'How either side can end the agreement.']],
        ['tip', 'Get local advice for long-term roles', 'Employment and tax rules differ from country to country. For long-term or full-time arrangements, speak to a qualified legal or tax adviser.'],
        ['h2', 'Plan payments and currency'],
        ['p', 'Agree the currency and payment schedule before work starts. Milestone-based payments make it clear what is being paid for, and when.'],
        ['h2', 'Onboard properly'],
        ['ol', ['Share the context: your product, customers and goals.', 'Give access to the tools and files they need on day one.', 'Introduce them to the people they’ll work with.', 'Agree how you’ll communicate, and how often.']],
        ['h2', 'Measure outcomes, not hours'],
        ['p', 'Focus on what is delivered and the quality of the work rather than how many hours someone appears to be online. Clear goals make this much easier.']
      ]
    },
    {
      slug: 'long-term-client-relationships', category: 'Business', date: '2026-08-10',
      title: 'How to Build Long-Term Client Relationships',
      excerpt: 'Why repeat clients matter, and the everyday habits that turn one project into an ongoing working relationship.',
      tags: ['clients', 'relationships', 'repeat work', 'business', 'communication', 'freelancing'],
      takeaways: ['Be reliable on the small things: replies, deadlines and promises.', 'Share progress before you’re asked, and handle problems openly.', 'When a project ends, suggest a sensible next step.'],
      body: [
        ['p', 'Finding new clients takes time and energy. Clients who come back again and again give you more stable work and often more interesting projects. Long-term relationships are built on everyday habits.'],
        ['h2', 'Be reliable on the small things'],
        ['p', 'Reply when you said you would, meet deadlines and keep your promises, even small ones. Reliability is often what clients value most.'],
        ['h2', 'Communicate before you’re asked'],
        ['ul', ['Share progress updates without waiting to be chased.', 'Let the client know early if something might be late.', 'Confirm decisions in writing after calls.']],
        ['h2', 'Handle problems openly'],
        ['p', 'Mistakes happen. What matters is how you deal with them. Explain what went wrong, what you’ll do to fix it and how you’ll prevent it next time.'],
        ['quote', 'Clients don’t expect perfection. They expect honesty and a plan.'],
        ['h2', 'Suggest the next step'],
        ['p', 'When a project ends, think about what the client might need next. A thoughtful suggestion, such as a follow-up improvement or a related service, can turn one project into an ongoing partnership.'],
        ['tip', 'Keep a simple client log', 'Note each client’s preferences, past projects and important dates. It helps you pick up where you left off, even months later.']
      ]
    },
    {
      slug: 'remote-work-habits-for-productivity', category: 'Remote Work', date: '2026-08-06',
      title: 'Remote Work Habits That Improve Productivity',
      excerpt: 'Small, practical habits for staying focused, organised and well when you work from home.',
      tags: ['remote work', 'productivity', 'habits', 'focus', 'wellbeing'],
      takeaways: ['Set a clear start and end to your working day.', 'Plan your top three tasks and protect time for focused work.', 'Take real breaks, and look back at each week to adjust.'],
      body: [
        ['p', 'Working from home gives you flexibility, but it can also blur the line between work and the rest of your life. Small, consistent habits help you stay focused and avoid burnout.'],
        ['h2', 'Set a clear start and end to your day'],
        ['p', 'Start at roughly the same time each day and have a simple routine to finish, such as writing tomorrow’s plan. It helps your mind switch in and out of work mode.'],
        ['h2', 'Plan your top three tasks'],
        ['p', 'Each morning, choose the three tasks that matter most and finish at least one of them before checking messages.'],
        ['h2', 'Protect your focus time'],
        ['ul', ['Turn off non-essential notifications while you work.', 'Check messages at set times instead of all day.', 'Block time in your calendar for deep work.']],
        ['tip', 'Plan around power cuts', 'If load-shedding affects your area, keep a UPS for your router and laptop, and schedule important calls for times when power is usually stable.'],
        ['h2', 'Take real breaks'],
        ['p', 'Step away from your screen regularly. A short walk, a stretch or a proper lunch break helps you come back with more energy.'],
        ['h2', 'Review your week'],
        ['p', 'At the end of each week, look at what you finished, what slipped and why. Small adjustments each week add up over time.']
      ]
    },
    {
      slug: 'essential-tools-for-remote-freelancers', category: 'Technology', date: '2026-08-02',
      title: 'Essential Tools for Remote Freelancers',
      excerpt: 'The types of tools that help you communicate, manage work, protect your files and deliver professionally.',
      tags: ['tools', 'technology', 'software', 'remote work', 'freelancing', 'security'],
      takeaways: ['Use one main channel for client messages and one place for tasks.', 'Keep organised cloud folders and follow the 3-2-1 backup rule.', 'Use a password manager and turn on two-factor authentication.'],
      body: [
        ['p', 'The right tools make remote work smoother, more professional and less stressful. You don’t need many, but you do need the basics covered.'],
        ['h2', 'Communication'],
        ['p', 'Use one main channel for client messages and a reliable video-calling tool for meetings. Agree with each client where conversations should happen so nothing gets lost.'],
        ['h2', 'Project and task management'],
        ['p', 'A simple task board or to-do list helps you track deadlines across several clients. Choose a tool you’ll actually keep up to date.'],
        ['h2', 'File sharing and backups'],
        ['p', 'Share files through organised cloud folders with clear names and version numbers, and always keep backups of your work.'],
        ['tip', 'Follow the 3-2-1 backup rule', 'Keep three copies of important files, on two different types of storage, with one copy stored off-site or in the cloud.'],
        ['h2', 'Time tracking and invoicing'],
        ['p', 'If you bill by the hour, track your time as you work rather than estimating later. Keep simple records of invoices and payments for each client.'],
        ['h2', 'Security basics'],
        ['ul', ['Use a password manager and unique passwords.', 'Turn on two-factor authentication for important accounts.', 'Keep your operating system and software updated.', 'Be careful when sharing client files over public Wi-Fi.']]
      ]
    },
    {
      slug: 'how-milestone-payments-protect-both-sides', category: 'Finance & Payments', date: '2026-07-29',
      title: 'How Milestone Payments Protect Clients and Freelancers',
      excerpt: 'Why splitting a project into funded milestones reduces risk for everyone involved.',
      tags: ['milestones', 'payments', 'safepay', 'escrow', 'finance'],
      takeaways: ['The work is split into stages, each with its own deliverable and payment.', 'The client funds each milestone through SafePay™ and releases it after approval.', 'Freelancers can see each stage is funded before they start.'],
      body: [
        ['p', 'Payment worries can damage even a good working relationship. Clients want to know they’ll get what they paid for, and freelancers want to know they’ll be paid for their work. Milestone payments help with both.'],
        ['h2', 'What is a milestone payment?'],
        ['p', 'Instead of paying for a whole project at once, the work is split into stages. Each stage has a clear deliverable and its own payment.'],
        ['h2', 'An example milestone plan'],
        ['p', 'Here is how a PKR 65,000 branding project might be split. The amounts are only an example.'],
        ['table', ['Milestone', 'Deliverable', 'Amount (PKR)'], [['1. Concept direction', 'Three logo concepts', '20,000'], ['2. Identity system', 'Final logo, colours and fonts', '25,000'], ['3. Packaging', 'Print-ready packaging files', '20,000']]],
        ['h2', 'How it works on Paklance'],
        ['ol', ['The client and specialist agree the milestones.', 'The client funds a milestone through SafePay™.', 'The specialist completes and submits the work.', 'The client reviews and approves it.', 'The payment for that milestone is released.']],
        ['h2', 'Benefits for both sides'],
        ['ul', ['**Clients** pay step by step and review work before each payment is released.', '**Freelancers** can see that each stage is funded before they start.', '**Both** have a clear record of what was agreed and delivered.']],
        ['tip', 'Make every milestone easy to check', 'Describe each deliverable so clearly that both sides can easily agree whether it has been completed.'],
        ['p', 'Funding by bank transfer is available now. JazzCash and Easypaisa are coming soon.']
      ]
    }
  ];

  /* ---------------- helpers ---------------- */
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var opts = {}, state = { q: '', cat: 'All' }, coverSeq = 0, seoOn = false, baseTitle = document.title, searchTimer;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function inline(t) { return esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'); }
  function plain(t) { return String(t).replace(/\*\*/g, ''); }
  function countWords(t) { return plain(t).split(/\s+/).filter(Boolean).length; }
  function slugify(t) { return String(t).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function fmtDate(iso) { if (!iso || typeof iso !== 'string' || iso.indexOf('-') === -1) return 'Recently'; var p = iso.split('-'); return (+p[2] || '') + ' ' + (MONTHS[+p[1] - 1] || '') + ' ' + (p[0] || ''); }
  function ic(name, cls) { return '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }
  function url(a) { return a ? SITE + '/blog/' + a.slug : SITE + '/blog'; }
  function href(a) { return '#blog/' + a.slug; }
  function notify(m) { if (opts.notify) opts.notify(m); }

  var BY_SLUG = {}, BY_DATE = [], FEATURED = null;
  // Builds the lookups (slug index, table of contents, read time). Runs again when the API sends articles.
  function index() {
    BY_SLUG = {};
    ARTICLES.forEach(function (a, i) {
      a.idx = i;
      BY_SLUG[a.slug] = a;
      a.toc = [];
      var n = countWords(a.title) + countWords(a.excerpt || '');
      if (a.content) {
        var textOnly = String(a.content).replace(/<[^>]*>/g, ' ');
        n += countWords(textOnly);
        var h2Regex = /<h2[^>]*>(.*?)<\/h2>/gi;
        var m;
        while ((m = h2Regex.exec(a.content)) !== null) {
          var h2Text = m[1].replace(/<[^>]*>/g, '').trim();
          var h2Id = a.slug + '--' + slugify(h2Text);
          a.toc.push({ id: h2Id, text: h2Text });
        }
      }
      if (Array.isArray(a.body)) {
        a.body.forEach(function (b) {
          var k = b[0];
          if (k === 'p' || k === 'h2' || k === 'h3' || k === 'quote' || k === 'img') n += countWords(b[1]);
          if (k === 'ul' || k === 'ol') b[1].forEach(function (x) { n += countWords(x); });
          if (k === 'tip') n += countWords(b[1]) + countWords(b[2]);
          if (k === 'table') { n += countWords(b[1].join(' ')); b[2].forEach(function (r) { n += countWords(r.join(' ')); }); }
          if (k === 'h2') { b.id = a.slug + '--' + slugify(b[1]); a.toc.push({ id: b.id, text: b[1] }); }
        });
      }
      a.readTime = Math.max(1, Math.round(n / 200));
    });
    BY_DATE = ARTICLES.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    FEATURED = ARTICLES.filter(function (a) { return a.featured; })[0] || BY_DATE[0] || null;
  }
  index();
  // Replace the built-in demo articles with articles from the API (same shape, plus demo: true|false).
  function setArticles(list) {
    ARTICLES.length = 0;
    (list || []).forEach(function (a) { ARTICLES.push(a); });
    index();
    renderHome();   // refresh the homepage 'From the blog' section with the API articles
  }

  function related(a) {
    return ARTICLES.filter(function (x) { return x !== a; }).map(function (x) {
      var s = (x.category === a.category ? 3 : 0) + x.tags.filter(function (t) { return a.tags.indexOf(t) > -1; }).length;
      return { x: x, s: s };
    }).sort(function (p, q) { return q.s - p.s || (p.x.date < q.x.date ? 1 : -1); }).map(function (p) { return p.x; });
  }
  function matches(a) {
    if (state.cat !== 'All' && a.category !== state.cat) return false;
    var q = state.q.trim().toLowerCase();
    if (!q) return true;
    var hay = (a.title + ' ' + a.category + ' ' + a.tags.join(' ') + ' ' + a.excerpt).toLowerCase();
    return q.split(/\s+/).every(function (w) { return hay.indexOf(w) > -1; });
  }

  /* ---------------- components ---------------- */
  function Cover(a, o) {
    o = o || {};
    var label = o.label || ('Illustration for “' + a.title + '”');
    var coverImg = a.coverImageUrl || a.coverImage;
    if (coverImg) {
      return '<img src="' + esc(coverImg) + '" alt="' + esc(label) + '" style="width:100%;height:100%;object-fit:cover;display:block;" loading="lazy">';
    }
    var st = CAT_STYLE[a.category] || CAT_STYLE['Freelancing'];
    var v = (a.idx + (o.variant || 0)) % 4;
    var pid = 'blogdots' + (++coverSeq);
    var big = [[520, 40, 170], [110, 320, 160], [560, 300, 150], [80, 50, 150]][v];
    var small = [[90, 300, 70], [540, 70, 80], [120, 80, 60], [520, 300, 90]][v];
    var card = [[70, 110], [300, 120], [230, 90], [90, 150]][v];
    var medal = [[430, 150], [120, 150], [470, 120], [440, 110]][v];
    return '<svg viewBox="0 0 640 360" preserveAspectRatio="xMidYMid slice" role="img" aria-label="' + esc(label) + '">' +
      '<defs><pattern id="' + pid + '" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.6" fill="' + st.fg + '" fill-opacity="0.22"></circle></pattern></defs>' +
      '<rect width="640" height="360" fill="' + st.bg + '"></rect>' +
      '<rect width="640" height="360" fill="url(#' + pid + ')"></rect>' +
      '<circle cx="' + big[0] + '" cy="' + big[1] + '" r="' + big[2] + '" fill="' + st.fg + '" fill-opacity="0.16"></circle>' +
      '<circle cx="' + small[0] + '" cy="' + small[1] + '" r="' + small[2] + '" fill="' + st.fg + '" fill-opacity="0.12"></circle>' +
      '<g transform="translate(' + card[0] + ' ' + card[1] + ')">' +
        '<rect width="230" height="132" rx="18" fill="#FFFFFF" fill-opacity="0.96" stroke="#0E1B14" stroke-opacity="0.06"></rect>' +
        '<rect x="20" y="22" width="44" height="44" rx="12" fill="' + st.bg + '"></rect>' +
        '<rect x="78" y="28" width="120" height="10" rx="5" fill="#0E1B14" fill-opacity="0.72"></rect>' +
        '<rect x="78" y="48" width="84" height="8" rx="4" fill="#0E1B14" fill-opacity="0.22"></rect>' +
        '<rect x="20" y="86" width="190" height="8" rx="4" fill="#0E1B14" fill-opacity="0.12"></rect>' +
        '<rect x="20" y="104" width="140" height="8" rx="4" fill="#0E1B14" fill-opacity="0.12"></rect>' +
      '</g>' +
      '<g transform="translate(' + medal[0] + ' ' + medal[1] + ')">' +
        '<circle cx="46" cy="46" r="46" fill="' + st.fg + '"></circle>' +
        '<svg x="22" y="22" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="' + st.bg + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><use href="#i-' + st.icon + '"></use></svg>' +
      '</g>' +
    '</svg>';
  }
  function Meta(a, withAuthor) {
    var authorName = a.authorName || (a.author && a.author.name) || AUTHOR.name;
    var authorInitials = authorName.split(' ').filter(Boolean).map(function(w){ return w[0]; }).slice(0, 2).join('').toUpperCase() || AUTHOR.initials;
    return '<div class="blog-meta">' +
      (withAuthor ? '<span class="blog-by"><span class="blog-avatar" aria-hidden="true">' + authorInitials + '</span>' + esc(authorName) + '</span>' : '') +
      '<span>' + ic('calendar') + '<time datetime="' + a.date + '">' + fmtDate(a.date) + '</time></span>' +
      '<span>' + ic('clock') + a.readTime + ' min read</span>' +
    '</div>';
  }

  function BlogSearch() {
    return '<form class="search blog-search" role="search" data-blog-search>' +
      '<label for="blogQ" class="skip">Search articles</label>' +
      '<input id="blogQ" type="search" placeholder="Search articles..." autocomplete="off" value="' + esc(state.q) + '">' +
      '<button class="btn btn-primary" type="submit">' + ic('search', 'ic-sm') + 'Search</button>' +
    '</form>';
  }
  function BlogHero() {
    return '<header class="page-head blog-hero"><div class="wrap">' +
      '<span class="eyebrow">Paklance Blog</span>' +
      '<h1>Insights for Better Work</h1>' +
      '<p>Practical insights, advice, and resources for freelancers, businesses, and global teams.</p>' +
      BlogSearch() +
    '</div></header>';
  }
  function BlogCategories() {
    return '<div class="blog-cats" role="group" aria-label="Filter by category">' + CATEGORIES.map(function (c) {
      return '<button type="button" data-blog-cat="' + esc(c) + '" aria-pressed="' + (c === state.cat) + '">' + esc(c) + '</button>';
    }).join('') + '</div>';
  }
  function FeaturedArticle(a) {
    return '<article class="blog-featured">' +
      '<a class="blog-cover" href="' + href(a) + '" tabindex="-1" aria-hidden="true">' + Cover(a) + '</a>' +
      '<div class="blog-featured-body">' +
        '<div class="blog-row"><span class="chip chip-verified">' + ic('sparkle', 'ic-xs') + 'Featured</span><span class="blog-cat">' + esc(a.category) + '</span></div>' +
        '<h2><a href="' + href(a) + '">' + esc(a.title) + '</a></h2>' +
        '<p>' + esc(a.excerpt) + '</p>' +
        Meta(a, true) +
        '<a class="btn btn-primary" href="' + href(a) + '">Read Article' + ic('arrow-right', 'ic-sm') + '</a>' +
      '</div>' +
    '</article>';
  }
  function BlogCard(a, small) {
    return '<article class="blog-card' + (small ? ' small' : '') + '">' +
      '<a class="blog-cover" href="' + href(a) + '" tabindex="-1" aria-hidden="true">' + Cover(a) + '</a>' +
      '<div class="blog-card-body">' +
        '<span class="blog-cat">' + esc(a.category) + '</span>' +
        '<h3><a href="' + href(a) + '">' + esc(a.title) + '</a></h3>' +
        (small ? '' : '<p>' + esc(a.excerpt) + '</p>') +
        (small ? '<div class="blog-meta"><span>' + ic('clock') + a.readTime + ' min read</span></div>' : Meta(a, true)) +
        '<a class="blog-read" href="' + href(a) + '">Read Article' + ic('arrow-right') + '<span class="skip">: ' + esc(a.title) + '</span></a>' +
      '</div>' +
    '</article>';
  }
  function EmptyState() {
    return '<div class="empty blog-empty">' + ic('search') +
      '<h3>No articles found</h3>' +
      '<p>We couldn’t find articles matching your search.</p>' +
      '<button class="btn btn-outline" type="button" data-blog-clear>Browse All Articles</button>' +
    '</div>';
  }
  function BlogGrid(list, small) {
    return list.length ? '<div class="blog-grid">' + list.map(function (a) { return BlogCard(a, small); }).join('') + '</div>' : EmptyState();
  }
  function PopularReads() {
    var list = ARTICLES.filter(function (a) { return a.popular; });
    return '<div class="blog-head"><div><h2 id="blogPopularTitle">Popular Reads</h2><p>A few good places to start.</p></div></div>' +
      '<div class="blog-popular">' + list.map(function (a) {
        return '<article class="blog-mini">' +
          '<a class="blog-cover" href="' + href(a) + '" tabindex="-1" aria-hidden="true">' + Cover(a, { variant: 1 }) + '</a>' +
          '<div class="blog-mini-body">' +
            '<div class="blog-row"><span class="chip chip-popular">Popular</span><span class="blog-cat">' + esc(a.category) + '</span></div>' +
            '<a href="' + href(a) + '"><strong>' + esc(a.title) + '</strong></a>' +
            '<div class="blog-meta"><span>' + ic('clock') + a.readTime + ' min read</span></div>' +
          '</div>' +
        '</article>';
      }).join('') + '</div>';
  }
  function NewsletterSignup(ctx) {
    var id = 'blogNews-' + ctx;
    return '<section class="blog-news" aria-labelledby="' + id + '-title">' +
      '<div><span class="eyebrow">Newsletter</span><h2 id="' + id + '-title">Stay Ahead of the Way We Work</h2>' +
        '<p>Get practical freelancing, hiring, and global work insights delivered to your inbox.</p></div>' +
      '<div>' +
        '<form class="blog-news-form" data-blog-news novalidate>' +
          '<label for="' + id + '" class="skip">Email address</label>' +
          '<input id="' + id + '" type="email" inputmode="email" autocomplete="email" placeholder="Enter your email">' +
          '<button class="btn btn-light" type="submit">Subscribe</button>' +
          '<p class="blog-news-err" role="alert" hidden></p>' +
        '</form>' +
        '<div class="blog-news-done" role="status" hidden>' + ic('check-circle') +
          '<div><strong>Thanks! You’re on the list.</strong><span>We’ll send you new articles and freelance tips when they’re published.</span></div>' +
        '</div>' +
      '</div>' +
    '</section>';
  }
  function ShareButtons(a) {
    var u = encodeURIComponent(url(a)), t = encodeURIComponent(a.title);
    return '<div class="blog-share"><span class="blog-share-label">Share</span>' +
      '<button type="button" data-blog-copy="' + esc(url(a)) + '">' + ic('link') + 'Copy link</button>' +
      '<a href="https://www.linkedin.com/sharing/share-offsite/?url=' + u + '" target="_blank" rel="noopener">LinkedIn</a>' +
      '<a href="https://x.com/intent/post?url=' + u + '&amp;text=' + t + '" target="_blank" rel="noopener">X</a>' +
      '<a href="https://wa.me/?text=' + t + '%20' + u + '" target="_blank" rel="noopener">WhatsApp</a>' +
      '<a href="https://www.facebook.com/sharer/sharer.php?u=' + u + '" target="_blank" rel="noopener">Facebook</a>' +
    '</div>';
  }
  function ArticleHeader(a) {
    var authorName = a.authorName || (a.author && a.author.name) || AUTHOR.name;
    var authorInitials = authorName.split(' ').filter(Boolean).map(function(w){ return w[0]; }).slice(0, 2).join('').toUpperCase() || AUTHOR.initials;
    return '<header class="blog-article-head">' +
      '<div class="blog-row"><span class="blog-cat">' + esc(a.category) + '</span></div>' +
      '<h1>' + esc(a.title) + '</h1>' +
      '<p class="blog-subtitle">' + esc(a.excerpt || '') + '</p>' +
      '<div class="blog-byline"><span class="avatar" aria-hidden="true">' + authorInitials + '</span><div>' +
        '<strong>' + esc(authorName) + '</strong>' +
        '<div class="blog-meta"><span>' + ic('calendar') + 'Published <time datetime="' + a.date + '">' + fmtDate(a.date) + '</time></span>' +
          (a.updated ? '<span>Updated <time datetime="' + a.updated + '">' + fmtDate(a.updated) + '</time></span>' : '') +
          '<span>' + ic('clock') + a.readTime + ' min read</span></div>' +
      '</div></div>' +
      ShareButtons(a) +
    '</header>';
  }
  var ckSeq = 0;
  function ArticleContent(a) {
    if (a.content) {
      return '<div class="blog-prose">' + a.content + '</div>';
    }
    if (!a.body || !Array.isArray(a.body)) return '';
    return '<div class="blog-prose">' + a.body.map(function (b) {
      switch (b[0]) {
        case 'p': return '<p>' + inline(b[1]) + '</p>';
        case 'h2': return '<h2 id="' + b.id + '">' + esc(b[1]) + '</h2>';
        case 'h3': return '<h3>' + esc(b[1]) + '</h3>';
        case 'ul': return '<ul>' + b[1].map(function (x) { return '<li>' + inline(x) + '</li>'; }).join('') + '</ul>';
        case 'ol': return '<ol' + (b[2] ? ' start="' + b[2] + '"' : '') + '>' + b[1].map(function (x) { return '<li>' + inline(x) + '</li>'; }).join('') + '</ol>';
        case 'tip': return '<aside class="blog-tip">' + ic('bulb') + '<div><strong>' + esc(b[1]) + '</strong><p>' + inline(b[2]) + '</p></div></aside>';
        case 'quote': return '<blockquote class="blog-quote"><p>' + inline(b[1]) + '</p><cite>' + esc(AUTHOR.name) + '</cite></blockquote>';
        case 'table': return '<div class="blog-table-wrap"><table class="blog-table"><thead><tr>' + b[1].map(function (h) { return '<th scope="col">' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          b[2].map(function (r) { return '<tr>' + r.map(function (c, i) { return i === 0 ? '<th scope="row">' + esc(c) + '</th>' : '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
        case 'img': return '<figure class="blog-figure"><div class="blog-cover">' + Cover(a, { variant: 2, label: b[1] }) + '</div><figcaption>' + esc(b[1]) + '</figcaption></figure>';
        case 'checklist': return Checklist(b, a.idx + '-' + (ckSeq++));
        case 'video': return '<figure class="blog-figure blog-video">' + (window.PaklanceVideo ? PaklanceVideo.player(PaklanceVideo.parse(b[2]), { title: b[1], label: 'Play the video guide', soon: 'Video guide coming soon' }) : '') + '<figcaption>' + esc(b[1]) + '</figcaption></figure>';
      }
      return '';
    }).join('') + '</div>';
  }
  function TableOfContents(a, mobile) {
    if (!a || !a.toc || a.toc.length < 3) return '';
    return '<details class="blog-toc' + (mobile ? ' blog-toc-mobile' : '') + '"' + (mobile ? '' : ' open') + '>' +
      '<summary>' + ic('list') + 'On this page' + (mobile ? '' : '<span class="blog-left" data-blog-left>' + a.readTime + ' min read</span>') + ic('chevron-down', 'chev') + '</summary>' +
      '<ol>' + a.toc.map(function (t) { return '<li><a href="' + href(a) + '" data-toc="' + t.id + '">' + esc(t.text) + '</a></li>'; }).join('') + '</ol>' +
    '</details>';
  }
  /* ---------- engagement: key takeaways, checklist, next step, "was this helpful?", reading progress ---------- */
  // The button at the end of an article matches its topic (an article can set its own "cta").
  var CTA = {
    profile: { title: 'Put this into practice', text: 'A complete profile helps the right clients find you.', button: 'Complete your profile', action: 'profile' },
    hire: { title: 'Ready to hire?', text: 'Post your job for free and get proposals from verified specialists.', button: 'Post a job', action: 'signup' },
    match: { title: 'Hiring from abroad?', text: 'Tell us the role and get a curated shortlist of verified specialists.', button: 'Get a Match™ shortlist', href: '#match' },
    work: { title: 'Looking for work?', text: 'Browse jobs with clear PKR budgets and protected milestones.', button: 'Browse jobs', href: '#jobs' },
    fees: { title: 'Know what you’ll pay', text: 'Work out the fees before you fund a milestone.', button: 'Try the fee calculator', href: '#pricing' },
    join: { title: 'Join Paklance', text: 'Create a free account in under a minute.', button: 'Create a free account', action: 'signup' }
  };
  var CTA_BY_CAT = { 'Freelancing': 'profile', 'Career & Skills': 'profile', 'Hiring': 'hire', 'Talent Management': 'hire', 'Business': 'hire',
    'Global Hiring': 'match', 'Remote Work': 'work', 'Productivity': 'work', 'Technology': 'work', 'Finance & Payments': 'fees', 'Paklance Updates': 'join' };
  function Takeaways(a) {
    if (!a.takeaways || !a.takeaways.length) return '';
    return '<section class="blog-takeaways" aria-label="Key takeaways"><h2>' + ic('bulb') + 'Key takeaways</h2><ul>' +
      a.takeaways.map(function (t) { return '<li>' + ic('check') + '<span>' + inline(t) + '</span></li>'; }).join('') + '</ul></section>';
  }
  function Checklist(b, n) {
    var id = 'blogck' + n;
    return '<section class="blog-check" data-blog-check aria-labelledby="' + id + '"><div class="blog-check-head"><strong id="' + id + '">' + esc(b[1]) + '</strong>' +
      '<span class="blog-check-count" aria-live="polite">0 of ' + b[2].length + ' done</span></div>' +
      '<span class="blog-check-bar" aria-hidden="true"><i></i></span><ul>' +
      b[2].map(function (t, i) { return '<li><label><input type="checkbox" data-blog-ck> <span>' + esc(t) + '</span></label></li>'; }).join('') + '</ul>' +
      '<p class="blog-check-done" hidden>' + ic('check-circle') + esc(b[3] || 'All done. Nice work.') + '</p></section>';
  }
  function NextStep(a) {
    var c = a.cta || CTA[CTA_BY_CAT[a.category] || 'join'];
    var btn = c.href ? '<a class="btn btn-light" href="' + c.href + '">' + esc(c.button) + ic('arrow-right') + '</a>'
      : '<button class="btn btn-light" type="button" data-blog-cta="' + c.action + '">' + esc(c.button) + ic('arrow-right') + '</button>';
    return '<section class="blog-next" aria-label="Next step"><div><span class="blog-next-eyebrow">Your next step</span><h2>' + esc(c.title) + '</h2><p>' + esc(c.text) + '</p></div>' + btn + '</section>';
  }
  function Helpful(a) {
    return '<section class="blog-helpful" data-blog-helpful="' + esc(a.slug) + '" aria-label="Feedback">' +
      '<div class="blog-helpful-ask"><strong>Was this article helpful?</strong><div class="blog-helpful-btns">' +
        '<button type="button" data-blog-vote="yes">' + ic('check') + 'Yes</button><button type="button" data-blog-vote="no">' + ic('x') + 'Not really</button></div></div>' +
      '<form class="blog-helpful-more" hidden><label for="bh-' + esc(a.slug) + '">What was missing or unclear?</label>' +
        '<textarea id="bh-' + esc(a.slug) + '" rows="3" maxlength="500" placeholder="Tell us in a sentence or two (optional)"></textarea>' +
        '<button class="btn btn-primary btn-sm" type="submit">Send feedback</button></form>' +
      '<p class="blog-helpful-thanks" hidden role="status"></p></section>';
  }
  // reading progress: a thin bar across the top, and "min left" next to "On this page"
  var progRaf = 0;
  function updateProgress() {
    progRaf = 0;
    var bar = document.querySelector('.blog-progress i'), main = document.querySelector('#blogArticle .blog-main');
    if (!bar || !main || !main.offsetParent) return;
    var r = main.getBoundingClientRect(), span = Math.max(1, r.height - window.innerHeight * 0.6);
    var p = Math.min(1, Math.max(0, (window.innerHeight * 0.25 - r.top) / span));
    bar.style.transform = 'scaleX(' + p.toFixed(4) + ')';
    var a = BY_SLUG[main.getAttribute('data-slug')], left = a ? Math.ceil(a.readTime * (1 - p)) : 0;
    Array.prototype.forEach.call(document.querySelectorAll('[data-blog-left]'), function (el) { el.textContent = p >= 0.98 ? 'Finished' : left + ' min left'; });
  }
  function onScroll() { if (!progRaf) progRaf = requestAnimationFrame(updateProgress); }
  function onCheck(e) {
    var box = e.target.closest && e.target.closest('[data-blog-check]'); if (!box || !e.target.hasAttribute('data-blog-ck')) return;
    var all = box.querySelectorAll('[data-blog-ck]'), n = box.querySelectorAll('[data-blog-ck]:checked').length;
    box.querySelector('.blog-check-count').textContent = n + ' of ' + all.length + ' done';
    box.querySelector('.blog-check-bar i').style.transform = 'scaleX(' + (n / all.length) + ')';
    box.classList.toggle('is-done', n === all.length);
    box.querySelector('.blog-check-done').hidden = n !== all.length;
  }

  function AuthorCard() {
    return '<section class="blog-author" aria-label="About the author">' +
      '<span class="avatar lg" aria-hidden="true">' + AUTHOR.initials + '</span>' +
      '<div><span class="blog-cat">Written by</span><strong>' + esc(AUTHOR.name) + '</strong><p>' + esc(AUTHOR.bio) + '</p></div>' +
    '</section>';
  }
  function RelatedArticles(a) {
    return '<section class="blog-related" aria-labelledby="blogRelatedTitle">' +
      '<div class="blog-head"><div><h2 id="blogRelatedTitle">You May Also Like</h2></div></div>' +
      BlogGrid(related(a).slice(0, 3), true) +
    '</section>';
  }
  function SideReading(a) {
    var rel = related(a);
    var list = rel.length >= 4 ? rel.slice(3, 6) : rel.slice(0, 3);
    if (!list.length) {
      list = ARTICLES.filter(function (x) { return x.slug !== a.slug; }).slice(0, 3);
    }
    return '<section class="blog-side-card" aria-labelledby="blogSideTitle"><h2 id="blogSideTitle">More on this topic</h2><ul class="blog-side-list">' +
      list.map(function (x) { return '<li><a href="' + href(x) + '"><span class="blog-cat">' + esc(x.category) + '</span><strong>' + esc(x.title) + '</strong></a></li>'; }).join('') +
    '</ul>' +
    '<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line-2)">' +
      '<a href="#blog" class="btn btn-outline btn-sm" style="display:block;text-align:center;width:100%;font-weight:600">Explore All Blog Articles →</a>' +
    '</div>' +
    '</section>';
  }

  /* ---------------- pages ---------------- */
  function updateResults() {
    var box = document.getElementById('blogResults'); if (!box) return;
    var q = state.q.trim(), filtering = !!q || state.cat !== 'All';
    var list = BY_DATE.filter(matches);
    if (!filtering) list = list.filter(function (a) { return a !== FEATURED; });
    box.innerHTML = BlogGrid(list);
    var fw = document.getElementById('blogFeaturedWrap'); if (fw) fw.hidden = filtering;
    var c = document.getElementById('blogCount');
    if (c) c.textContent = !filtering ? 'The newest guides and updates.' :
      (list.length + (list.length === 1 ? ' article' : ' articles') + (q ? ' matching “' + q + '”' : '') + (state.cat !== 'All' ? ' in ' + state.cat : '') + '.');
    Array.prototype.forEach.call(document.querySelectorAll('[data-blog-cat]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-blog-cat') === state.cat)); });
  }
  function renderIndex() {
    var root = document.getElementById('blogIndex'); if (!root) return;
    root.innerHTML = BlogHero() +
      '<div class="wrap">' +
        (FEATURED ? '<section class="blog-section" id="blogFeaturedWrap" aria-label="Featured article">' + FeaturedArticle(FEATURED) + '</section>' : '') +
        '<section class="blog-section" id="blogLatest" aria-labelledby="blogLatestTitle">' +
          '<div class="blog-head"><div><h2 id="blogLatestTitle">Latest Articles</h2><p id="blogCount" aria-live="polite"></p></div></div>' +
          BlogCategories() + '<div id="blogResults"></div>' +
        '</section>' +
        (ARTICLES.some(function (a) { return a.popular; }) ? '<section class="blog-section" aria-labelledby="blogPopularTitle">' + PopularReads() + '</section>' : '') +
        '<div class="blog-section">' + NewsletterSignup('idx') + '</div>' +
      '</div>';
    updateResults();
    applySeo({ title: 'Insights for Better Work | Paklance Blog', description: 'Practical insights, advice, and resources for freelancers, businesses, and global teams.', url: url(null), image: SITE + '/blog/images/blog-cover.png', type: 'website' });
  }
  function renderArticle(slug) {
    var a = BY_SLUG[slug], root = document.getElementById('blogArticle');
    if (!a || !root) return false;
    root.innerHTML = '<article class="blog-article">' +
      '<div class="blog-progress" aria-hidden="true"><i></i></div>' +
      '<div class="page-head"><div class="wrap">' +
        '<nav class="blog-crumbs" aria-label="Breadcrumb"><a href="#blog">Blog</a><span aria-hidden="true">/</span><a href="#blog" data-blog-cat-link="' + esc(a.category) + '">' + esc(a.category) + '</a></nav>' +
        ArticleHeader(a) +
      '</div></div>' +
      '<div class="wrap">' +
        '<figure class="blog-hero-img"><div class="blog-cover">' + Cover(a, { variant: 1 }) + '</div></figure>' +
        '<div class="blog-layout">' +
          '<div class="blog-main" data-slug="' + esc(a.slug) + '">' +
            TableOfContents(a, true) +
            Takeaways(a) +
            ArticleContent(a) +
            NextStep(a) +
            Helpful(a) +
            '<div class="blog-share-end">' + ShareButtons(a) + '</div>' +
            AuthorCard() +
          '</div>' +
          '<aside class="blog-side" aria-label="On this page and related reading">' + TableOfContents(a, false) + SideReading(a) + '</aside>' +
        '</div>' +
        RelatedArticles(a) +
        '<div class="blog-section">' + NewsletterSignup('art') + '</div>' +
      '</div>' +
    '</article>';
    applySeo({
      title: (a.metaTitle || (a.title + ' | Paklance Blog')),
      description: (a.metaDescription || a.excerpt || ''),
      url: url(a),
      image: (a.coverImageUrl || a.coverImage || (SITE + '/blog/images/' + a.slug + '.png')),
      type: 'article',
      article: a
    });
    setTimeout(updateProgress, 0);
    return true;
  }

  /* ---------------- SEO (title, description, canonical, Open Graph, JSON-LD) ---------------- */
  function setMeta(attr, key, val) {
    var el = document.head.querySelector('meta[' + attr + '="' + key + '"][data-blog-seo]');
    if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); el.setAttribute('data-blog-seo', ''); document.head.appendChild(el); }
    el.setAttribute('content', val);
  }
  function clearSeo() {
    Array.prototype.forEach.call(document.head.querySelectorAll('[data-blog-seo]'), function (el) { el.parentNode.removeChild(el); });
    document.title = baseTitle; seoOn = false;
  }
  function applySeo(o) {
    clearSeo(); seoOn = true;
    document.title = o.title;
    setMeta('name', 'description', o.description || '');
    var link = document.createElement('link'); link.rel = 'canonical'; link.href = o.url; link.setAttribute('data-blog-seo', ''); document.head.appendChild(link);
    setMeta('property', 'og:site_name', 'Paklance');
    setMeta('property', 'og:type', o.type);
    setMeta('property', 'og:title', o.title);
    setMeta('property', 'og:description', o.description || '');
    setMeta('property', 'og:url', o.url);
    if (o.image) setMeta('property', 'og:image', o.image);
    setMeta('name', 'twitter:card', 'summary_large_image');
    if (o.article) {
      var a = o.article;
      var auth = a.authorName || (a.author && a.author.name) || AUTHOR.name;
      setMeta('property', 'article:published_time', a.date);
      if (a.updated) setMeta('property', 'article:modified_time', a.updated);
      setMeta('property', 'article:author', auth);
      setMeta('property', 'article:section', a.category);
      setMeta('name', 'author', auth);
      var ld = document.createElement('script'); ld.type = 'application/ld+json'; ld.setAttribute('data-blog-seo', '');
      ld.textContent = JSON.stringify({ '@context': 'https://schema.org', '@type': 'BlogPosting', headline: a.title, description: a.metaDescription || a.excerpt, image: o.image, datePublished: a.date, dateModified: a.updated || a.date, author: { '@type': 'Person', name: auth }, publisher: { '@type': 'Organization', name: 'Paklance' }, mainEntityOfPage: o.url, articleSection: a.category, keywords: (a.tags || []).join(', ') });
      document.head.appendChild(ld);
    }
  }

  /* ---------------- events ---------------- */
  function copyLink(u) {
    var fail = function () { notify('Copy this link: ' + u); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(u).then(function () { notify('Link copied.'); }, fail);
      else fail();
    } catch (e) { fail(); }
  }
  function onClick(e) {
    var v = e.target.closest('[data-blog-vote]');
    if (v) {
      var hb = v.closest('[data-blog-helpful]'), yes = v.getAttribute('data-blog-vote') === 'yes';
      hb.querySelector('.blog-helpful-ask').hidden = true;
      if (opts.onFeedback) opts.onFeedback(hb.getAttribute('data-blog-helpful'), yes ? 'yes' : 'no', '');
      if (yes) { var th = hb.querySelector('.blog-helpful-thanks'); th.textContent = 'Thanks! Glad it helped.'; th.hidden = false; }
      else { hb.querySelector('.blog-helpful-more').hidden = false; hb.querySelector('textarea').focus(); }
      return;
    }
    var c = e.target.closest('[data-blog-cta]');
    if (c) { if (opts.onCta) opts.onCta(c.getAttribute('data-blog-cta')); return; }
    var t = e.target.closest('[data-blog-cat],[data-blog-clear],[data-toc],[data-blog-copy],[data-blog-cat-link]');
    if (!t) return;
    if (t.hasAttribute('data-blog-cat')) { state.cat = t.getAttribute('data-blog-cat'); updateResults(); return; }
    if (t.hasAttribute('data-blog-clear')) {
      state.q = ''; state.cat = 'All';
      var inp = document.getElementById('blogQ'); if (inp) inp.value = '';
      updateResults(); if (inp) inp.focus({ preventScroll: true });
      return;
    }
    if (t.hasAttribute('data-toc')) {
      e.preventDefault();
      var h = document.getElementById(t.getAttribute('data-toc'));
      if (h) h.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      var d = t.closest('details.blog-toc-mobile'); if (d) d.open = false;
      return;
    }
    if (t.hasAttribute('data-blog-copy')) { copyLink(t.getAttribute('data-blog-copy')); return; }
    if (t.hasAttribute('data-blog-cat-link')) { state.cat = t.getAttribute('data-blog-cat-link'); state.q = ''; }
  }
  function onInput(e) {
    if (!e.target || e.target.id !== 'blogQ') return;
    var v = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { state.q = v; updateResults(); }, 150);
  }
  function onSubmit(e) {
    var f = e.target;
    if (f.hasAttribute('data-blog-search')) {
      e.preventDefault();
      clearTimeout(searchTimer);
      state.q = f.querySelector('input').value; updateResults();
      var sec = document.getElementById('blogLatest'); if (sec) sec.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      return;
    }
    if (f.hasAttribute('data-blog-news')) {
      e.preventDefault();
      var inp = f.querySelector('input'), err = f.querySelector('.blog-news-err'), v = inp.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) {
        err.textContent = v ? 'Enter a valid email address, like name@example.com.' : 'Enter your email address.';
        err.hidden = false; inp.setAttribute('aria-invalid', 'true'); inp.focus(); return;
      }
      err.hidden = true; inp.removeAttribute('aria-invalid');
      var done = function (live) {
        var box = f.parentNode.querySelector('.blog-news-done');
        if (live) box.querySelector('span').textContent = 'We’ve sent a welcome email to ' + v + '.';
        f.hidden = true; box.hidden = false;
      };
      if (!opts.subscribe) { done(false); return; }
      var btn = f.querySelector('button'); btn.disabled = true;
      opts.subscribe(v).then(function () { done(true); }, function (e) {
        err.textContent = (e && e.message) || 'Something went wrong. Please try again.'; err.hidden = false;
      }).then(function () { btn.disabled = false; });
    }
  }

  /* ---------------- Homepage "From the blog": the 3 newest articles ---------------- */
  function renderHome() {
    var list = document.getElementById('homeBlogList'); if (!list) return;
    var latest = BY_DATE.slice(0, 3);
    var sec = list.closest('section'); if (sec) sec.hidden = !latest.length;
    list.innerHTML = latest.map(function (a) { return BlogCard(a); }).join('');
    var dots = document.getElementById('homeBlogDots');
    if (dots) dots.innerHTML = latest.map(function (a, i) { return '<span' + (i ? '' : ' class="on"') + '></span>'; }).join('');
    if (list.hasAttribute('data-bound')) return;
    list.setAttribute('data-bound', '');
    list.addEventListener('scroll', function () {     // mobile: keep the dots in step with the swipe
      var cards = list.children, d = document.getElementById('homeBlogDots');
      if (!cards.length || !d) return;
      var step = cards[0].getBoundingClientRect().width + 14;
      var i = Math.max(0, Math.min(cards.length - 1, Math.round(list.scrollLeft / step)));
      Array.prototype.forEach.call(d.children, function (dot, k) { dot.classList.toggle('on', k === i); });
    }, { passive: true });
  }

  function init(o) {
    opts = o || {};
    baseTitle = opts.baseTitle || document.title;
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onCheck);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    document.addEventListener('submit', function (e) {
      var f = e.target.closest && e.target.closest('.blog-helpful-more'); if (!f) return;
      e.preventDefault();
      var hb = f.closest('[data-blog-helpful]'), text = f.querySelector('textarea').value.trim();
      if (opts.onFeedback) opts.onFeedback(hb.getAttribute('data-blog-helpful'), 'no', text);
      f.hidden = true;
      var th = hb.querySelector('.blog-helpful-thanks'); th.textContent = 'Thanks for telling us. We’ll use it to improve this article.'; th.hidden = false;
    });
    document.addEventListener('submit', onSubmit);
    renderHome();
  }

  return {
    init: init,
    renderIndex: renderIndex,
    renderArticle: renderArticle,
    renderHome: renderHome,
    leave: function () { if (seoOn) clearSeo(); },
    has: function (slug) { return !!BY_SLUG[slug]; },
    articles: ARTICLES,
    setArticles: setArticles,
    categories: CATEGORIES
  };
})();
/* ===== PAKLANCE BLOG: JS END ===== */
