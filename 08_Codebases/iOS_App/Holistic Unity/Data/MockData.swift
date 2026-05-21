import Foundation

/// Provides sample data for development and previews
enum MockData {
    
    // MARK: - Therapist Profiles
    
    static let therapists: [TherapistProfile] = [
        TherapistProfile(
            id: "t1",
            displayName: "ND. Lorenzo M.",
            tagline: "Naturopathic Doctor & Ayurveda Consultant",
            bio: "With over 15 years of experience in naturopathic medicine, I combine traditional healing practices with modern wellness approaches. My journey began in Italy where I studied natural medicine before earning my Naturopathic Doctor degree. I specialize in helping clients find balance through personalized treatment plans that integrate naturopathy and Ayurveda to address mind, body, and spirit.",
            photoURL: nil,
            yearsExperience: 15,
            categories: [.naturopathy, .ayurveda],
            languages: ["English", "Italian", "Spanish"],
            services: [
                TherapistService(id: "s1", name: "Initial Naturopathic Consultation", description: "Comprehensive health assessment and personalized treatment plan", duration: 90, price: 150, category: .naturopathy),
                TherapistService(id: "s2", name: "Follow-up Session", description: "Progress review and treatment adjustment", duration: 60, price: 95, category: .naturopathy),
                TherapistService(id: "s3", name: "Ayurveda Consultation", description: "Dosha analysis and personalized lifestyle guidance", duration: 60, price: 110, category: .ayurveda),
                TherapistService(id: "s4", name: "Ayurvedic Nutrition Plan", description: "Custom dietary guidance based on your constitution", duration: 45, price: 80, category: .ayurveda)
            ],
            certifications: [
                Certificate(id: "c1", name: "Doctor of Naturopathic Medicine", issuingOrganization: "Bastyr University", yearObtained: 2010, isVerified: true),
                Certificate(id: "c2", name: "Ayurvedic Health Counselor", issuingOrganization: "National Ayurvedic Medical Association", yearObtained: 2013, isVerified: true),
                Certificate(id: "c3", name: "Certified Naturopath", issuingOrganization: "American Naturopathic Medical Association", yearObtained: 2008, isVerified: false)
            ],
            galleryImageURLs: [],
            availability: TherapistAvailability(
                recurring: [
                    .monday: [TimeRange(start: "09:00", end: "12:00"), TimeRange(start: "14:00", end: "18:00")],
                    .tuesday: [TimeRange(start: "09:00", end: "17:00")],
                    .wednesday: [TimeRange(start: "10:00", end: "16:00")],
                    .thursday: [TimeRange(start: "09:00", end: "17:00")],
                    .friday: [TimeRange(start: "09:00", end: "14:00")]
                ],
                exceptions: [],
                timezone: "America/New_York",
                minNoticeHours: 24,
                bufferMinutes: 15
            ),
            cancellationPolicy: .flexible,
            currency: .usd,
            location: User.UserLocation(city: "Milano", country: "IT", latitude: 45.4642, longitude: 9.1900),
            averageRating: 4.9,
            totalReviews: 127,
            profileCompleteness: 95,
            isVerified: true,
            isApproved: true,
            approvalStatus: .approved,
            stripeConnectedAccountId: "acct_mock1",
            stripeAccountStatus: .active,
            createdAt: Date().addingTimeInterval(-365 * 24 * 3600),
            updatedAt: Date()
        ),
        TherapistProfile(
            id: "t2",
            displayName: "Sofia Rodriguez",
            tagline: "Family & Systemic Constellation Facilitator",
            bio: "I help people uncover hidden family and systemic dynamics that influence their lives. Having trained in Europe and Latin America, I bring a diverse perspective to constellation work. My approach is gentle yet powerful — we work together to reveal inherited patterns, release generational trauma, and restore balance in all areas of life.",
            photoURL: nil,
            yearsExperience: 8,
            categories: [.familyConstellation, .systemicConstellation],
            languages: ["English", "Spanish"],
            services: [
                TherapistService(id: "s5", name: "Family Constellation Session", description: "Explore and heal family dynamics", duration: 75, price: 95, category: .familyConstellation),
                TherapistService(id: "s6", name: "Systemic Constellation", description: "Work and relationship system exploration", duration: 60, price: 85, category: .systemicConstellation),
                TherapistService(id: "s7", name: "Individual Constellation", description: "One-on-one constellation for personal clarity", duration: 45, price: 65, category: .familyConstellation)
            ],
            certifications: [
                Certificate(id: "c4", name: "Certified Constellation Facilitator", issuingOrganization: "Hellinger Institute", yearObtained: 2017, isVerified: true),
                Certificate(id: "c5", name: "Systemic Therapist", issuingOrganization: "European Association for Systemic Therapy", yearObtained: 2019, isVerified: true)
            ],
            galleryImageURLs: [],
            availability: TherapistAvailability(
                recurring: [
                    .monday: [TimeRange(start: "07:00", end: "12:00")],
                    .wednesday: [TimeRange(start: "07:00", end: "12:00")],
                    .friday: [TimeRange(start: "07:00", end: "12:00")],
                    .saturday: [TimeRange(start: "09:00", end: "14:00")]
                ],
                exceptions: [],
                timezone: "America/Los_Angeles",
                minNoticeHours: 12,
                bufferMinutes: 15
            ),
            cancellationPolicy: .flexible,
            currency: .usd,
            location: User.UserLocation(city: "Roma", country: "IT", latitude: 41.9028, longitude: 12.4964),
            averageRating: 4.8,
            totalReviews: 89,
            profileCompleteness: 90,
            isVerified: true,
            isApproved: true,
            approvalStatus: .approved,
            stripeConnectedAccountId: "acct_mock2",
            stripeAccountStatus: .active,
            createdAt: Date().addingTimeInterval(-200 * 24 * 3600),
            updatedAt: Date()
        ),
        TherapistProfile(
            id: "t3",
            displayName: "James Walker",
            tagline: "Reiki Master & Numerologist",
            bio: "As a Reiki Master and numerologist, I create sacred spaces for deep healing and transformation. My sessions blend the gentle energy of distance Reiki with the ancient wisdom of numerology to help you understand your life path and restore energetic balance.",
            photoURL: nil,
            yearsExperience: 12,
            categories: [.reiki, .numerology],
            languages: ["English"],
            services: [
                TherapistService(id: "s8", name: "Reiki a Distanza", description: "Full-body energy balancing with Usui Reiki", duration: 60, price: 90, category: .reiki),
                TherapistService(id: "s9", name: "Numerology Reading", description: "Life path analysis and personal cycle insights", duration: 75, price: 110, category: .numerology),
                TherapistService(id: "s10", name: "Distance Reiki", description: "Remote energy healing session", duration: 45, price: 70, category: .reiki)
            ],
            certifications: [
                Certificate(id: "c6", name: "Usui Reiki Master/Teacher", issuingOrganization: "International Center for Reiki Training", yearObtained: 2014, isVerified: true)
            ],
            galleryImageURLs: [],
            availability: TherapistAvailability(
                recurring: [
                    .tuesday: [TimeRange(start: "10:00", end: "18:00")],
                    .thursday: [TimeRange(start: "10:00", end: "18:00")],
                    .saturday: [TimeRange(start: "10:00", end: "15:00")]
                ],
                exceptions: [],
                timezone: "America/Chicago",
                minNoticeHours: 24,
                bufferMinutes: 30
            ),
            cancellationPolicy: .moderate,
            currency: .usd,
            location: User.UserLocation(city: "Bologna", country: "IT", latitude: 44.4949, longitude: 11.3426),
            averageRating: 4.7,
            totalReviews: 56,
            profileCompleteness: 85,
            isVerified: true,
            isApproved: true,
            approvalStatus: .approved,
            stripeConnectedAccountId: "acct_mock3",
            stripeAccountStatus: .active,
            createdAt: Date().addingTimeInterval(-150 * 24 * 3600),
            updatedAt: Date()
        ),
        TherapistProfile(
            id: "t4",
            displayName: "Aya Kimura",
            tagline: "ThetaHealing & Human Design Practitioner",
            bio: "Trained in ThetaHealing and Human Design, I offer a holistic approach that honors ancient wisdom while embracing modern understanding of the mind-body connection. Specializing in belief work, energetic alignment, and living authentically according to your design.",
            photoURL: nil,
            yearsExperience: 10,
            categories: [.thetaHealing, .humanDesign],
            languages: ["English", "Japanese"],
            services: [
                TherapistService(id: "s11", name: "ThetaHealing Session", description: "Deep belief work and energy healing", duration: 60, price: 120, category: .thetaHealing),
                TherapistService(id: "s12", name: "Human Design Reading", description: "Body graph analysis and strategy guidance", duration: 45, price: 75, category: .humanDesign)
            ],
            certifications: [
                Certificate(id: "c7", name: "Certified ThetaHealing Practitioner", issuingOrganization: "THInK Institute", yearObtained: 2015, isVerified: true)
            ],
            galleryImageURLs: [],
            availability: TherapistAvailability(
                recurring: [
                    .monday: [TimeRange(start: "09:00", end: "17:00")],
                    .wednesday: [TimeRange(start: "09:00", end: "17:00")],
                    .friday: [TimeRange(start: "09:00", end: "13:00")]
                ],
                exceptions: [],
                timezone: "America/New_York",
                minNoticeHours: 48,
                bufferMinutes: 15
            ),
            cancellationPolicy: .moderate,
            currency: .usd,
            location: User.UserLocation(city: "Firenze", country: "IT", latitude: 43.7696, longitude: 11.2558),
            averageRating: 4.9,
            totalReviews: 98,
            profileCompleteness: 88,
            isVerified: true,
            isApproved: true,
            approvalStatus: .approved,
            stripeConnectedAccountId: "acct_mock4",
            stripeAccountStatus: .active,
            createdAt: Date().addingTimeInterval(-300 * 24 * 3600),
            updatedAt: Date()
        ),
        TherapistProfile(
            id: "t6",
            displayName: "Giulia Ferreira",
            tagline: "ThetaHealing Instructor & Astrologer",
            bio: "Nascida no Brasil e formada em ThetaHealing nos EUA, ajudo pessoas a transformar crenças limitantes e acessar o seu potencial mais elevado. Combino sessões de ThetaHealing com consultas de Astrologia para oferecer clareza, cura emocional e orientação prática. As minhas sessões online são em português, italiano e inglês.",
            photoURL: nil,
            yearsExperience: 9,
            categories: [.thetaHealing, .astrology],
            languages: ["Portuguese", "Italian", "English"],
            services: [
                TherapistService(id: "s15", name: "ThetaHealing — Belief Work", description: "Deep subconscious belief reprogramming for lasting change", duration: 60, price: 110, category: .thetaHealing),
                TherapistService(id: "s16", name: "Astrology Consultation", description: "Birth chart reading and life guidance", duration: 45, price: 75, category: .astrology),
                TherapistService(id: "s17", name: "ThetaHealing + Astrology Combo", description: "Combined session: astrology insight followed by theta belief work", duration: 90, price: 150, category: .thetaHealing),
                TherapistService(id: "s18", name: "Reiki a Distanza", description: "Distance energy healing session", duration: 60, price: 95, category: .reiki)
            ],
            certifications: [
                Certificate(id: "c10", name: "Certified ThetaHealing Instructor", issuingOrganization: "THInK Institute", yearObtained: 2018, isVerified: true),
                Certificate(id: "c11", name: "Advanced ThetaHealing Practitioner", issuingOrganization: "THInK Institute", yearObtained: 2016, isVerified: true),
                Certificate(id: "c12", name: "Professional Astrologer", issuingOrganization: "Italian Astrology Association", yearObtained: 2019, isVerified: true)
            ],
            galleryImageURLs: [],
            availability: TherapistAvailability(
                recurring: [
                    .monday: [TimeRange(start: "09:00", end: "13:00"), TimeRange(start: "15:00", end: "19:00")],
                    .tuesday: [TimeRange(start: "09:00", end: "18:00")],
                    .wednesday: [TimeRange(start: "09:00", end: "13:00")],
                    .thursday: [TimeRange(start: "09:00", end: "18:00")],
                    .friday: [TimeRange(start: "10:00", end: "16:00")],
                    .saturday: [TimeRange(start: "10:00", end: "14:00")]
                ],
                exceptions: [],
                timezone: "America/Sao_Paulo",
                minNoticeHours: 24,
                bufferMinutes: 15
            ),
            cancellationPolicy: .flexible,
            currency: .brl,
            location: User.UserLocation(city: "São Paulo", country: "BR", latitude: -23.5505, longitude: -46.6333),
            averageRating: 4.9,
            totalReviews: 214,
            profileCompleteness: 98,
            isVerified: true,
            isApproved: true,
            approvalStatus: .approved,
            stripeConnectedAccountId: "acct_mock6",
            stripeAccountStatus: .active,
            createdAt: Date().addingTimeInterval(-280 * 24 * 3600),
            updatedAt: Date()
        ),
        TherapistProfile(
            id: "t5",
            displayName: "Emma Thompson",
            tagline: "Astrologer & Human Design Analyst",
            bio: "I guide individuals through transformative self-discovery using astrology and Human Design. Together we'll uncover your unique energetic blueprint, understand your life path, and create lasting positive alignment with your authentic nature.",
            photoURL: nil,
            yearsExperience: 7,
            categories: [.astrology, .humanDesign],
            languages: ["English", "French"],
            services: [
                TherapistService(id: "s13", name: "Astrology Birth Chart Reading", description: "Complete natal chart analysis and guidance", duration: 60, price: 100, category: .astrology),
                TherapistService(id: "s14", name: "Human Design Analysis", description: "Full body graph reading and strategy session", duration: 75, price: 130, category: .humanDesign)
            ],
            certifications: [
                Certificate(id: "c8", name: "Professional Astrologer", issuingOrganization: "Faculty of Astrological Studies", yearObtained: 2018, isVerified: true),
                Certificate(id: "c9", name: "Certified Human Design Analyst", issuingOrganization: "International Human Design School", yearObtained: 2019, isVerified: true)
            ],
            galleryImageURLs: [],
            availability: TherapistAvailability(
                recurring: [
                    .tuesday: [TimeRange(start: "11:00", end: "19:00")],
                    .thursday: [TimeRange(start: "11:00", end: "19:00")],
                    .saturday: [TimeRange(start: "10:00", end: "16:00")]
                ],
                exceptions: [],
                timezone: "Europe/London",
                minNoticeHours: 24,
                bufferMinutes: 15
            ),
            cancellationPolicy: .flexible,
            currency: .gbp,
            location: User.UserLocation(city: "London", country: "UK", latitude: 51.5074, longitude: -0.1278),
            averageRating: 4.8,
            totalReviews: 73,
            profileCompleteness: 92,
            isVerified: true,
            isApproved: true,
            approvalStatus: .approved,
            stripeConnectedAccountId: "acct_mock5",
            stripeAccountStatus: .active,
            createdAt: Date().addingTimeInterval(-180 * 24 * 3600),
            updatedAt: Date()
        )
    ]
    
    // MARK: - Reviews
    
    static let reviews: [Review] = [
        Review(id: "r1", bookingId: "b1", clientId: "cl1", therapistId: "t1", clientName: "Marcello D.", clientPhotoURL: nil, rating: 5, text: "Lorenzo is truly gifted. After just one session, I felt a significant shift in my energy levels. His approach is both professional and deeply compassionate. Highly recommended!", therapistReply: "Thank you Marcello! It was wonderful working with you. Looking forward to our next session.", therapistReplyDate: Date().addingTimeInterval(-5 * 24 * 3600), isFlagged: false, createdAt: Date().addingTimeInterval(-7 * 24 * 3600)),
        Review(id: "r2", bookingId: "b2", clientId: "cl2", therapistId: "t1", clientName: "Sarah K.", clientPhotoURL: nil, rating: 5, text: "Incredible experience. Lorenzo's naturopathic approach has completely changed how I think about my health. The herbal remedies he prescribed have been so effective.", therapistReply: nil, therapistReplyDate: nil, isFlagged: false, createdAt: Date().addingTimeInterval(-14 * 24 * 3600)),
        Review(id: "r3", bookingId: "b3", clientId: "cl3", therapistId: "t1", clientName: "Mike R.", clientPhotoURL: nil, rating: 4, text: "Very knowledgeable and thorough. The initial consultation was comprehensive. Only giving 4 stars because the scheduling could be more flexible.", therapistReply: nil, therapistReplyDate: nil, isFlagged: false, createdAt: Date().addingTimeInterval(-30 * 24 * 3600)),
        Review(id: "r4", bookingId: "b4", clientId: "cl4", therapistId: "t2", clientName: "Jenny L.", clientPhotoURL: nil, rating: 5, text: "Sofia's constellation session was transformative. I finally understood the patterns I had been repeating from my family.", therapistReply: nil, therapistReplyDate: nil, isFlagged: false, createdAt: Date().addingTimeInterval(-10 * 24 * 3600)),
        Review(id: "r5", bookingId: "b5", clientId: "cl5", therapistId: "t3", clientName: "David H.", clientPhotoURL: nil, rating: 5, text: "The distance Reiki session was an incredible experience. James creates a safe and healing space even remotely.", therapistReply: "Thank you David, it's always a joy to share this work!", therapistReplyDate: Date().addingTimeInterval(-3 * 24 * 3600), isFlagged: false, createdAt: Date().addingTimeInterval(-5 * 24 * 3600)),
        Review(id: "r6", bookingId: "b6", clientId: "cl6", therapistId: "t6", clientName: "Ana Paula S.", clientPhotoURL: nil, rating: 5, text: "A Giulia é incrível! A sessão de ThetaHealing mudou completamente minha perspectiva sobre um problema que me acompanhava há anos. Super recomendo!", therapistReply: "Obrigada Ana Paula! Foi lindo acompanhar sua transformação. Te espero na próxima sessão!", therapistReplyDate: Date().addingTimeInterval(-1 * 24 * 3600), isFlagged: false, createdAt: Date().addingTimeInterval(-3 * 24 * 3600)),
        Review(id: "r7", bookingId: "b7", clientId: "cl7", therapistId: "t6", clientName: "Chiara M.", clientPhotoURL: nil, rating: 5, text: "Ho fatto una consulenza di astrologia con Giulia ed è stata un'esperienza profonda. Molto intuitiva e professionale, parla benissimo italiano!", therapistReply: nil, therapistReplyDate: nil, isFlagged: false, createdAt: Date().addingTimeInterval(-8 * 24 * 3600))
    ]
    
    // MARK: - Bookings
    
    // MARK: - Conversations
    
    static let conversations: [Conversation] = [
        Conversation(
            id: "conv1",
            participants: ["cl1", "t1"],
            lastMessage: Conversation.LastMessage(
                text: "Looking forward to our session on Thursday! Remember to drink plenty of water beforehand.",
                senderId: "t1",
                timestamp: Date().addingTimeInterval(-2 * 3600),
                type: .text
            ),
            unreadCount: ["cl1": 1, "t1": 0],
            createdAt: Date().addingTimeInterval(-30 * 24 * 3600),
            updatedAt: Date().addingTimeInterval(-2 * 3600)
        ),
        Conversation(
            id: "conv2",
            participants: ["cl1", "t2"],
            lastMessage: Conversation.LastMessage(
                text: "Thank you for the constellation session tips! I've been reflecting every morning.",
                senderId: "cl1",
                timestamp: Date().addingTimeInterval(-24 * 3600),
                type: .text
            ),
            unreadCount: ["cl1": 0, "t2": 1],
            createdAt: Date().addingTimeInterval(-14 * 24 * 3600),
            updatedAt: Date().addingTimeInterval(-24 * 3600)
        ),
        Conversation(
            id: "conv3",
            participants: ["cl1", "t3"],
            lastMessage: Conversation.LastMessage(
                text: "Your Reiki session has been confirmed for Saturday at 10:00 AM.",
                senderId: "t3",
                timestamp: Date().addingTimeInterval(-3 * 24 * 3600),
                type: .sessionLink
            ),
            unreadCount: ["cl1": 0, "t3": 0],
            createdAt: Date().addingTimeInterval(-7 * 24 * 3600),
            updatedAt: Date().addingTimeInterval(-3 * 24 * 3600)
        )
    ]
    
    static func messages(for conversationId: String) -> [ChatMessage] {
        switch conversationId {
        case "conv1":
            return [
                ChatMessage(id: "m1", senderId: "cl1", type: .text, content: .init(text: "Hi Lorenzo! I was wondering about the naturopathic consultation. What should I prepare?"), timestamp: Date().addingTimeInterval(-26 * 3600), isDeleted: false),
                ChatMessage(id: "m2", senderId: "t1", type: .text, content: .init(text: "Hello! Great question. Please bring any recent lab work you have, and make a list of any supplements or medications you're currently taking."), timestamp: Date().addingTimeInterval(-25 * 3600), isDeleted: false),
                ChatMessage(id: "m3", senderId: "cl1", type: .text, content: .init(text: "Perfect, I have my bloodwork from last month. Should I avoid eating before the session?"), timestamp: Date().addingTimeInterval(-24 * 3600), isDeleted: false),
                ChatMessage(id: "m4", senderId: "t1", type: .text, content: .init(text: "No need to fast, but try to eat a light meal. Also, wear comfortable clothing as we may do some physical assessments."), timestamp: Date().addingTimeInterval(-23 * 3600), isDeleted: false),
                ChatMessage(id: "m5", senderId: "cl1", type: .text, content: .init(text: "Sounds good! Thank you so much."), timestamp: Date().addingTimeInterval(-5 * 3600), isDeleted: false),
                ChatMessage(id: "m6", senderId: "t1", type: .text, content: .init(text: "Looking forward to our session on Thursday! Remember to drink plenty of water beforehand."), timestamp: Date().addingTimeInterval(-2 * 3600), isDeleted: false)
            ]
        case "conv2":
            return [
                ChatMessage(id: "m7", senderId: "t2", type: .text, content: .init(text: "Hi! After our constellation session, I wanted to share some reflections you can work with at home."), timestamp: Date().addingTimeInterval(-48 * 3600), isDeleted: false),
                ChatMessage(id: "m8", senderId: "t2", type: .text, content: .init(text: "Try journaling about the family dynamics we uncovered. Write a letter to the ancestor we worked with — you don't need to send it."), timestamp: Date().addingTimeInterval(-47 * 3600), isDeleted: false),
                ChatMessage(id: "m9", senderId: "cl1", type: .text, content: .init(text: "Thank you for the constellation session tips! I've been reflecting every morning."), timestamp: Date().addingTimeInterval(-24 * 3600), isDeleted: false)
            ]
        default:
            return [
                ChatMessage(id: "m10", senderId: "t3", type: .sessionLink, content: .init(text: "Your Reiki session has been confirmed for Saturday at 10:00 AM.", bookingId: "bk3"), timestamp: Date().addingTimeInterval(-3 * 24 * 3600), isDeleted: false)
            ]
        }
    }
    
    static func therapist(for id: String) -> TherapistProfile? {
        therapists.first { $0.id == id }
    }
    
    // MARK: - Bookings
    
    static let upcomingBookings: [Booking] = [
        Booking(id: "bk1", clientId: "cl1", therapistId: "t1", serviceId: "s1", serviceName: "Initial Naturopathic Consultation", duration: 90, price: 150, scheduledAt: Date().addingTimeInterval(2 * 24 * 3600 + 10 * 3600), timezone: "America/New_York", status: .confirmed, videoRoomId: "room_1", platformFee: 22.50, therapistPayout: 127.50, rescheduleCount: 0, packBookingId: nil, createdAt: Date(), updatedAt: Date()),
        Booking(id: "bk2", clientId: "cl1", therapistId: "t2", serviceId: "s6", serviceName: "Systemic Constellation", duration: 60, price: 85, scheduledAt: Date().addingTimeInterval(5 * 24 * 3600 + 14 * 3600), timezone: "America/Los_Angeles", status: .confirmed, videoRoomId: "room_2", platformFee: 12.75, therapistPayout: 72.25, rescheduleCount: 0, packBookingId: nil, createdAt: Date(), updatedAt: Date())
    ]
}
