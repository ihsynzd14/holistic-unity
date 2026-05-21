import Foundation
import Supabase

/// Supabase implementation of TherapistRepositoryProtocol.
/// Handles therapist profile CRUD, search, and file uploads.
final class SupabaseTherapistRepository: TherapistRepositoryProtocol, @unchecked Sendable {
    
    private let client: SupabaseClient
    
    init(client: SupabaseClient = SupabaseConfig.client) {
        self.client = client
    }
    
    // MARK: - Profile CRUD
    
    private static let profileColumns = "id,display_name,tagline,bio,photo_url,years_experience,categories,languages,video_intro_url,gallery_image_urls,availability,cancellation_policy,currency,city,country,latitude,longitude,average_rating,total_reviews,profile_completeness,is_verified,is_approved,approval_status,stripe_connected_account_id,stripe_account_status,created_at,updated_at"

    func getProfile(therapistId: String) async throws -> TherapistProfile {
        // Fetch profile — select only DTO columns to avoid decoding failures from extra DB columns
        let profileDTO: TherapistProfileDTO = try await client
            .from(SupabaseConfig.Table.therapistProfiles)
            .select(Self.profileColumns)
            .eq("id", value: therapistId)
            .single()
            .execute()
            .value
        
        // Fetch services — only active ones are shown to clients.
        // Therapists can disable services without deleting them via dashboard toggle.
        let servicesDTO: [TherapistServiceDTO] = try await client
            .from(SupabaseConfig.Table.therapistServices)
            .select()
            .eq("therapist_id", value: therapistId)
            .eq("is_active", value: true)
            .execute()
            .value
        
        // Fetch certifications
        let certsDTO: [CertificateDTO] = try await client
            .from(SupabaseConfig.Table.certifications)
            .select()
            .eq("therapist_id", value: therapistId)
            .execute()
            .value
        
        return mapToProfile(profileDTO, services: servicesDTO, certifications: certsDTO)
    }
    
    func createProfile(_ profile: TherapistProfile) async throws {
        let now = ISO8601DateFormatter.shared.string(from: Date())
        let profileDTO = mapToProfileDTO(profile, now: now)
        
        try await client.from(SupabaseConfig.Table.therapistProfiles)
            .upsert(profileDTO, onConflict: "id")
            .execute()
        
        // Insert services
        for service in profile.services {
            let serviceDTO = TherapistServiceDTO(
                id: service.id,
                therapistId: profile.id,
                name: service.name,
                description: service.description,
                duration: service.duration,
                price: service.price,
                // dbValue (Italian/dashed) keeps web + iOS in sync; using
                // rawValue would write snake_case the web filter never matches.
                category: service.category.dbValue,
                isIntroCall: service.isIntroCall,
                packSize: service.packSize,
                packPrice: service.packPrice
            )
            try await client.from(SupabaseConfig.Table.therapistServices)
                .upsert(serviceDTO, onConflict: "id")
                .execute()
        }
        
        // Insert certifications
        for cert in profile.certifications {
            let certDTO = CertificateDTO(
                id: cert.id,
                therapistId: profile.id,
                name: cert.name,
                issuingOrganization: cert.issuingOrganization,
                yearObtained: cert.yearObtained,
                documentURL: cert.imageURL?.absoluteString,
                isVerified: cert.isVerified
            )
            try await client.from(SupabaseConfig.Table.certifications)
                .upsert(certDTO, onConflict: "id")
                .execute()
        }
    }
    
    func updateProfile(_ profile: TherapistProfile) async throws {
        // Lightweight struct for fetching only IDs from related tables
        struct IdRow: Decodable { let id: String }
        
        let now = ISO8601DateFormatter.shared.string(from: Date())
        let profileDTO = mapToProfileDTO(profile, now: now)
        
        try await client.from(SupabaseConfig.Table.therapistProfiles)
            .update(profileDTO)
            .eq("id", value: profile.id)
            .execute()
        
        // Upsert services (avoids breaking foreign key references from bookings)
        let currentServiceIds = Set(profile.services.map { $0.id })
        
        // Fetch existing service IDs to find ones to remove
        let existingServices: [IdRow] = try await client
            .from(SupabaseConfig.Table.therapistServices)
            .select("id")
            .eq("therapist_id", value: profile.id)
            .execute()
            .value
        
        // Soft-remove services that are no longer in the profile.
        // We must NOT delete services referenced by existing bookings, as the
        // bookings.service_id column has a NOT NULL constraint. Check first.
        let removedIds = existingServices.map(\.id).filter { !currentServiceIds.contains($0) }
        for removedId in removedIds {
            // Check if any bookings reference this service
            let bookingCount: [IdRow]? = try? await client
                .from(SupabaseConfig.Table.bookings)
                .select("id")
                .eq("service_id", value: removedId)
                .limit(1)
                .execute()
                .value
            
            // Only delete if no bookings reference it
            if let bookings = bookingCount, bookings.isEmpty {
                _ = try? await client.from(SupabaseConfig.Table.therapistServices)
                    .delete()
                    .eq("id", value: removedId)
                    .execute()
            }
            // If bookings exist, leave the service in place (orphaned but safe)
        }
        
        // Upsert current services
        for service in profile.services {
            let serviceDTO = TherapistServiceDTO(
                id: service.id,
                therapistId: profile.id,
                name: service.name,
                description: service.description,
                duration: service.duration,
                price: service.price,
                // dbValue (Italian/dashed) keeps web + iOS in sync; using
                // rawValue would write snake_case the web filter never matches.
                category: service.category.dbValue,
                isIntroCall: service.isIntroCall,
                packSize: service.packSize,
                packPrice: service.packPrice
            )
            try await client.from(SupabaseConfig.Table.therapistServices)
                .upsert(serviceDTO, onConflict: "id")
                .execute()
        }
        
        // Upsert certifications (same approach)
        let currentCertIds = Set(profile.certifications.map { $0.id })
        
        let existingCerts: [IdRow] = try await client
            .from(SupabaseConfig.Table.certifications)
            .select("id")
            .eq("therapist_id", value: profile.id)
            .execute()
            .value
        
        let removedCertIds = existingCerts.map(\.id).filter { !currentCertIds.contains($0) }
        for removedCertId in removedCertIds {
            _ = try? await client.from(SupabaseConfig.Table.certifications)
                .delete()
                .eq("id", value: removedCertId)
                .execute()
        }
        
        for cert in profile.certifications {
            let certDTO = CertificateDTO(
                id: cert.id,
                therapistId: profile.id,
                name: cert.name,
                issuingOrganization: cert.issuingOrganization,
                yearObtained: cert.yearObtained,
                documentURL: cert.imageURL?.absoluteString,
                isVerified: cert.isVerified
            )
            try await client.from(SupabaseConfig.Table.certifications)
                .upsert(certDTO, onConflict: "id")
                .execute()
        }
    }
    
    func submitForReview(therapistId: String) async throws {
        try await client.rpc("submit_therapist_profile_for_review").execute()
    }
    
    // MARK: - Search
    
    func searchTherapists(
        query: String?,
        categories: [TherapyCategory],
        languages: [String],
        minRating: Double?,
        priceRange: ClosedRange<Double>?,
        sortBy: TherapistSortOption,
        page: Int,
        pageSize: Int
    ) async throws -> [TherapistProfile] {
        // Build filter query — must match RLS policy: approved + active Stripe only
        var filterQuery = client.from(SupabaseConfig.Table.therapistProfiles)
            .select(Self.profileColumns)
            .eq("is_approved", value: true)
            .eq("approval_status", value: "approved")
            .eq("stripe_account_status", value: "active")
        
        // Text search on display_name, tagline, bio
        // Sanitize query to prevent PostgREST filter injection
        if let query, !query.isEmpty {
            // Escape characters that are special in PostgREST ILIKE patterns
            let sanitized = query
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "%", with: "\\%")
                .replacingOccurrences(of: "_", with: "\\_")
                .replacingOccurrences(of: ",", with: "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !sanitized.isEmpty {
                filterQuery = filterQuery.or("display_name.ilike.%\(sanitized)%,tagline.ilike.%\(sanitized)%,bio.ilike.%\(sanitized)%")
            }
        }
        
        // Filter by categories — use DB values (Italian/hyphen) not Swift rawValues
        if !categories.isEmpty {
            let categoryStrings = categories.map { $0.dbValue }
            filterQuery = filterQuery.contains("categories", value: categoryStrings)
        }
        
        // Filter by languages — therapist must speak at least one of the requested languages
        if !languages.isEmpty {
            filterQuery = filterQuery.overlaps("languages", value: languages)
        }
        
        // Filter by min rating
        if let minRating {
            filterQuery = filterQuery.gte("average_rating", value: minRating)
        }
        
        // Determine sort column
        let orderColumn: String
        let ascending: Bool
        
        switch sortBy {
        case .rating:
            orderColumn = "average_rating"
            ascending = false
        case .priceLowToHigh:
            // Price sorting is applied client-side after fetching services;
            // use total_reviews as a reasonable default DB ordering
            orderColumn = "total_reviews"
            ascending = false
        case .priceHighToLow:
            orderColumn = "total_reviews"
            ascending = false
        case .relevance, .distance:
            orderColumn = "total_reviews"
            ascending = false
        }
        
        // Apply sorting and pagination (these return PostgrestTransformBuilder)
        let from = page * pageSize
        let to = from + pageSize - 1
        
        let profileDTOs: [TherapistProfileDTO] = try await filterQuery
            .order(orderColumn, ascending: ascending)
            .range(from: from, to: to)
            .execute()
            .value
        
        // Batch-fetch services and certs for all profiles in 2 queries instead of N*2
        let therapistIds = profileDTOs.map { $0.id }
        
        let allServices: [TherapistServiceDTO] = therapistIds.isEmpty ? [] : try await client
            .from(SupabaseConfig.Table.therapistServices)
            .select()
            .in("therapist_id", values: therapistIds)
            .eq("is_active", value: true)
            .execute()
            .value
        
        let allCerts: [CertificateDTO] = therapistIds.isEmpty ? [] : try await client
            .from(SupabaseConfig.Table.certifications)
            .select()
            .in("therapist_id", values: therapistIds)
            .execute()
            .value
        
        // Group by therapist ID
        let servicesByTherapist = Dictionary(grouping: allServices, by: { $0.therapistId })
        let certsByTherapist = Dictionary(grouping: allCerts, by: { $0.therapistId })
        
        var profiles: [TherapistProfile] = []
        for dto in profileDTOs {
            profiles.append(mapToProfile(
                dto,
                services: servicesByTherapist[dto.id] ?? [],
                certifications: certsByTherapist[dto.id] ?? []
            ))
        }
        
        // Client-side price filtering and sorting
        if let priceRange {
            profiles = profiles.filter { profile in
                guard let minPrice = profile.startingPrice else { return false }
                return priceRange.contains(minPrice)
            }
        }
        
        if sortBy == .priceLowToHigh {
            profiles.sort { ($0.startingPrice ?? 0) < ($1.startingPrice ?? 0) }
        } else if sortBy == .priceHighToLow {
            profiles.sort { ($0.startingPrice ?? 0) > ($1.startingPrice ?? 0) }
        }
        
        return profiles
    }
    
    func getFeaturedTherapists() async throws -> [TherapistProfile] {
        try await searchTherapists(
            query: nil,
            categories: [],
            languages: [],
            minRating: nil,
            priceRange: nil,
            sortBy: .rating,
            page: 0,
            pageSize: 10
        )
    }

    func getRecommendedTherapists(for clientProfile: ClientProfile) async throws -> [TherapistProfile] {
        try await searchTherapists(
            query: nil,
            categories: clientProfile.interests,
            languages: clientProfile.preferredLanguages,
            minRating: nil,
            priceRange: nil,
            sortBy: .rating,
            page: 0,
            pageSize: 10
        )
    }
    
    func getNearbyTherapists(latitude: Double, longitude: Double, radiusKm: Double) async throws -> [TherapistProfile] {
        // Simple bounding box filter — a proper geospatial query would use PostGIS
        let latDelta = radiusKm / 111.0
        let lonDelta = radiusKm / (111.0 * cos(latitude * .pi / 180.0))
        
        let profileDTOs: [TherapistProfileDTO] = try await client
            .from(SupabaseConfig.Table.therapistProfiles)
            .select(Self.profileColumns)
            .eq("is_approved", value: true)
            .eq("approval_status", value: "approved")
            .eq("stripe_account_status", value: "active")
            .gte("latitude", value: latitude - latDelta)
            .lte("latitude", value: latitude + latDelta)
            .gte("longitude", value: longitude - lonDelta)
            .lte("longitude", value: longitude + lonDelta)
            .execute()
            .value
        
        let nearbyIds = profileDTOs.map { $0.id }
        
        let nearbyServices: [TherapistServiceDTO] = nearbyIds.isEmpty ? [] : try await client
            .from(SupabaseConfig.Table.therapistServices)
            .select()
            .in("therapist_id", values: nearbyIds)
            .eq("is_active", value: true)
            .execute()
            .value
        
        let nearbyCerts: [CertificateDTO] = nearbyIds.isEmpty ? [] : try await client
            .from(SupabaseConfig.Table.certifications)
            .select()
            .in("therapist_id", values: nearbyIds)
            .execute()
            .value
        
        let svcByTherapist = Dictionary(grouping: nearbyServices, by: { $0.therapistId })
        let crtByTherapist = Dictionary(grouping: nearbyCerts, by: { $0.therapistId })
        
        var profiles: [TherapistProfile] = []
        for dto in profileDTOs {
            profiles.append(mapToProfile(
                dto,
                services: svcByTherapist[dto.id] ?? [],
                certifications: crtByTherapist[dto.id] ?? []
            ))
        }
        
        return profiles
    }
    
    // MARK: - File Uploads
    
    func uploadProfilePhoto(therapistId: String, imageData: Data) async throws -> URL {
        try await uploadFile(
            bucket: SupabaseConfig.Bucket.profilePhotos,
            path: "\(therapistId)/profile.jpg",
            data: imageData,
            contentType: "image/jpeg"
        )
    }
    
    func uploadVideoIntro(therapistId: String, videoURL: URL) async throws -> URL {
        let videoData = try Data(contentsOf: videoURL)
        return try await uploadFile(
            bucket: SupabaseConfig.Bucket.videoIntros,
            path: "\(therapistId)/intro.mp4",
            data: videoData,
            contentType: "video/mp4"
        )
    }
    
    func uploadCertificateImage(therapistId: String, certificateId: String, imageData: Data) async throws -> URL {
        try await uploadFile(
            bucket: SupabaseConfig.Bucket.certificates,
            path: "\(therapistId)/\(certificateId).jpg",
            data: imageData,
            contentType: "image/jpeg"
        )
    }
    
    func uploadGalleryImage(therapistId: String, imageData: Data) async throws -> URL {
        let imageId = UUID().uuidString
        return try await uploadFile(
            bucket: SupabaseConfig.Bucket.profilePhotos,
            path: "\(therapistId)/gallery/\(imageId).jpg",
            data: imageData,
            contentType: "image/jpeg"
        )
    }
    
    // MARK: - Private Helpers
    
    private func uploadFile(bucket: String, path: String, data: Data, contentType: String) async throws -> URL {
        try await client.storage
            .from(bucket)
            .upload(path, data: data, options: .init(contentType: contentType, upsert: true))
        
        let publicURL = try client.storage
            .from(bucket)
            .getPublicURL(path: path)
        
        return publicURL
    }
    
    /// Maps raw category strings from the DB to TherapyCategory enum values.
    /// The DB stores categories in Italian with hyphens (e.g. "costellazioni-familiari"),
    /// while the Swift enum uses English snake_case raw values.
    private static func mapCategory(_ raw: String) -> TherapyCategory? {
        // Try direct match first (handles any future English values)
        if let direct = TherapyCategory(rawValue: raw) { return direct }
        switch raw {
        case "theta-healing", "theta_healing", "ThetaHealing":
            return .thetaHealing
        case "costellazioni-familiari", "family_constellation", "Family Constellation", "Costellazioni Familiari":
            return .familyConstellation
        case "costellazioni-sistemiche", "systemic_constellation", "Systemic Constellation", "Costellazioni Sistemiche":
            return .systemicConstellation
        case "naturopatia", "naturopathy", "Naturopathy", "Naturopatia":
            return .naturopathy
        case "ayurveda", "Ayurveda", "Ayurveda Consultation", "Consulenza Ayurveda":
            return .ayurveda
        case "astrologia", "astrology", "Astrology", "Astrologia":
            return .astrology
        case "human-design", "human_design", "Human Design":
            return .humanDesign
        case "numerologia", "numerology", "Numerology", "Numerologia":
            return .numerology
        case "reiki", "Reiki", "Reiki a Distanza", "Distance Reiki":
            return .reiki
        case "sciamanesimo", "shamanism", "Shamanism", "Sciamanesimo":
            return .shamanism
        default:
            return nil
        }
    }

    private func mapToProfile(
        _ dto: TherapistProfileDTO,
        services: [TherapistServiceDTO],
        certifications: [CertificateDTO]
    ) -> TherapistProfile {
        let formatter = ISO8601DateFormatter.shared
        let location: User.UserLocation? = {
            guard let city = dto.city, let country = dto.country else { return nil }
            return User.UserLocation(city: city, country: country, latitude: dto.latitude, longitude: dto.longitude)
        }()
        
        return TherapistProfile(
            id: dto.id,
            displayName: dto.displayName,
            tagline: dto.tagline,
            bio: dto.bio,
            photoURL: dto.photoURL.flatMap { URL(string: $0) },
            yearsExperience: dto.yearsExperience,
            categories: dto.categories.compactMap { Self.mapCategory($0) },
            languages: dto.languages,
            services: services.map { $0.toDomain() },
            certifications: certifications.map { $0.toDomain() },
            videoIntroURL: dto.videoIntroURL.flatMap { URL(string: $0) },
            galleryImageURLs: dto.galleryImageURLs.compactMap { URL(string: $0) },
            availability: dto.availability ?? .default,
            cancellationPolicy: .standard,
            currency: dto.currency.flatMap { Currency(rawValue: $0) } ?? .usd,
            location: location,
            averageRating: dto.averageRating,
            totalReviews: dto.totalReviews,
            profileCompleteness: dto.profileCompleteness,
            isVerified: dto.isVerified,
            isApproved: dto.isApproved,
            approvalStatus: TherapistProfile.ApprovalStatus(rawValue: dto.approvalStatus) ?? .draft,
            stripeConnectedAccountId: dto.stripeConnectedAccountId,
            stripeAccountStatus: dto.stripeAccountStatus.flatMap { TherapistProfile.StripeAccountStatus(rawValue: $0) } ?? .notConnected,
            createdAt: formatter.date(from: dto.createdAt) ?? Date(),
            updatedAt: formatter.date(from: dto.updatedAt) ?? Date()
        )
    }
    
    private func mapToProfileDTO(_ profile: TherapistProfile, now: String) -> TherapistProfileDTO {
        TherapistProfileDTO(
            id: profile.id,
            displayName: profile.displayName,
            tagline: profile.tagline,
            bio: profile.bio,
            photoURL: profile.photoURL?.absoluteString,
            yearsExperience: profile.yearsExperience,
            // Encode categories using dbValue (Italian/dashed) so the rows
            // match what the web app reads/writes. Using rawValue here would
            // store snake_case values that the web filter (`dbValue`-based)
            // would never match, hiding the therapist from search.
            categories: profile.categories.map { $0.dbValue },
            languages: profile.languages,
            videoIntroURL: profile.videoIntroURL?.absoluteString,
            galleryImageURLs: profile.galleryImageURLs.map { $0.absoluteString },
            availability: profile.availability,
            cancellationPolicy: CancellationPolicy.standard.rawValue,
            currency: profile.currency.rawValue,
            city: profile.location?.city,
            country: profile.location?.country,
            latitude: profile.location?.latitude,
            longitude: profile.location?.longitude,
            averageRating: profile.averageRating,
            totalReviews: profile.totalReviews,
            profileCompleteness: profile.profileCompleteness,
            isVerified: profile.isVerified,
            isApproved: profile.isApproved,
            approvalStatus: profile.approvalStatus.rawValue,
            stripeConnectedAccountId: profile.stripeConnectedAccountId,
            stripeAccountStatus: profile.stripeAccountStatus.rawValue,
            createdAt: now,
            updatedAt: now
        )
    }
}
