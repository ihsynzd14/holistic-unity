import Foundation
import Supabase

/// Centralized storage service for uploading and managing files in Supabase Storage.
/// Used by repositories that need file upload capabilities.
final class SupabaseStorageService: @unchecked Sendable {
    
    static let shared = SupabaseStorageService()
    
    private let client: SupabaseClient
    
    init(client: SupabaseClient = SupabaseConfig.client) {
        self.client = client
    }
    
    // MARK: - Upload
    
    /// Upload image data and return the public URL
    func uploadImage(
        bucket: String,
        path: String,
        data: Data,
        upsert: Bool = true
    ) async throws -> URL {
        try await client.storage
            .from(bucket)
            .upload(path, data: data, options: .init(contentType: "image/jpeg", upsert: upsert))
        
        return try client.storage
            .from(bucket)
            .getPublicURL(path: path)
    }
    
    /// Upload video data and return the public URL
    func uploadVideo(
        bucket: String,
        path: String,
        data: Data,
        contentType: String = "video/mp4",
        upsert: Bool = true
    ) async throws -> URL {
        try await client.storage
            .from(bucket)
            .upload(path, data: data, options: .init(contentType: contentType, upsert: upsert))
        
        return try client.storage
            .from(bucket)
            .getPublicURL(path: path)
    }
    
    /// Upload audio data and return the public URL
    func uploadAudio(
        bucket: String,
        path: String,
        data: Data,
        upsert: Bool = false
    ) async throws -> URL {
        try await client.storage
            .from(bucket)
            .upload(path, data: data, options: .init(contentType: "audio/m4a", upsert: upsert))
        
        return try client.storage
            .from(bucket)
            .getPublicURL(path: path)
    }
    
    // MARK: - Delete
    
    /// Delete a file from a storage bucket
    func deleteFile(bucket: String, path: String) async throws {
        try await client.storage
            .from(bucket)
            .remove(paths: [path])
    }
    
    /// Delete multiple files from a storage bucket
    func deleteFiles(bucket: String, paths: [String]) async throws {
        try await client.storage
            .from(bucket)
            .remove(paths: paths)
    }
    
    // MARK: - URL Generation
    
    /// Get the public URL for a file
    func getPublicURL(bucket: String, path: String) throws -> URL {
        try client.storage
            .from(bucket)
            .getPublicURL(path: path)
    }
    
    /// Generate a signed URL with expiration for private files
    func getSignedURL(bucket: String, path: String, expiresIn: Int = 3600) async throws -> URL {
        try await client.storage
            .from(bucket)
            .createSignedURL(path: path, expiresIn: expiresIn)
    }
}
