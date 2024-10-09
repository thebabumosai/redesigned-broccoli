"use client"

import { useState, useCallback, useEffect, useRef } from 'react'
import { Upload, MapPin, Camera, Check, AlertCircle, X } from 'lucide-react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useToast } from "@/hooks/use-toast"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MeiliSearch } from 'meilisearch'
import ExifReader from 'exifreader'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'


interface UploadedPhoto {
  id: number;
  file: File;
  preview: string;
  location?: string;
  coordinates?: [number, number];
}

interface UserData {
  username: string;
  email?: string;
  redditUsername?: string;
}

interface PandalInfo {
  uid: string;
  name: string;
  coordinates: [number, number];
  address?: string;
}

const MEILISEARCH_ENDPOINT = 'https://search.pujo.club'
const INDEX_UID = 'pujos'
const API_TOKEN = process.env.NEXT_PUBLIC_MEILISEARCHKEY

const client = new MeiliSearch({
  host: MEILISEARCH_ENDPOINT,
  apiKey: API_TOKEN,
})

const index = client.index(INDEX_UID)

const imageTypes = [
  { value: 'pandal', label: 'Pandal Image' },
  { value: 'atmosphere', label: 'Atmosphere Image' },
  { value: 'protima', label: 'Protima Image' },
  { value: 'performance', label: 'Performance Image' },
  { value: 'food', label: 'Food Image' },
  { value: 'other', label: 'Other' },
]

const DEFAULT_CENTER: [number, number] = [88.3639, 22.5726] // Kolkata coordinates
const DEFAULT_ZOOM = 12

export default function PujoPictures() {
  const [dragActive, setDragActive] = useState(false)
  const [uploadedPhoto, setUploadedPhoto] = useState<UploadedPhoto | null>(null)
  const [userData, setUserData] = useState<UserData | null>(null)
  const [isUserDataModalOpen, setIsUserDataModalOpen] = useState(false)
  const [tempUsername, setTempUsername] = useState('')
  const [tempEmail, setTempEmail] = useState('')
  const [tempRedditUsername, setTempRedditUsername] = useState('')
  const [locationSearch, setLocationSearch] = useState('')
  const [locationResults, setLocationResults] = useState<PandalInfo[]>([])
  const [mapCenter, setMapCenter] = useState<[number, number]>(DEFAULT_CENTER)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [selectedPandal, setSelectedPandal] = useState<PandalInfo | null>(null)
  const [mapZoom, setMapZoom] = useState(DEFAULT_ZOOM)
  const [isSubmissionSuccessDialogOpen, setIsSubmissionSuccessDialogOpen] = useState(false)
  const [submissionId, setSubmissionId] = useState<string | null>(null)
  const [isLocationConfirmDialogOpen, setIsLocationConfirmDialogOpen] = useState(false)
  const [pendingPandal, setPendingPandal] = useState<PandalInfo | null>(null)
  const [imageType, setImageType] = useState('pandal')
  const [showNewPandalBanner, setShowNewPandalBanner] = useState(false)
  const [isNoLocationSelectedDialogOpen, setIsNoLocationSelectedDialogOpen] = useState(false)
  const [autoFilledLocation, setAutoFilledLocation] = useState<PandalInfo | null>(null)  

  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const locationInputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const { toast } = useToast()

  useEffect(() => {
    const storedUserData = localStorage.getItem('userData')
    if (storedUserData) {
      setUserData(JSON.parse(storedUserData))
    }

    if (mapContainerRef.current && !mapRef.current) {
      mapRef.current = new maplibregl.Map({
        container: mapContainerRef.current,
        style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
        center: mapCenter,
        zoom: mapZoom,
        interactive: false
      })

      mapRef.current.on('load', () => {
        if (mapRef.current) {
          mapRef.current.resize()
        }
      })
    }

    document.addEventListener('click', handleClickOutside)
    return () => {
      document.removeEventListener('click', handleClickOutside)
    }
  }, [mapCenter, mapZoom])

  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.setCenter(mapCenter)
      mapRef.current.setZoom(mapZoom)
      updateMapMarker()
    }
  }, [mapCenter, mapZoom])

  const updateMapMarker = () => {
    if (mapRef.current) {
      if (markerRef.current) {
        markerRef.current.remove()
      }
      if (selectedPandal) {
        markerRef.current = new maplibregl.Marker()
          .setLngLat([selectedPandal.coordinates[1], selectedPandal.coordinates[0]])
          .addTo(mapRef.current)
      }
    }
  }

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0])
    }
  }, [])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
    //check if file is an image
    const file = e.target.files[0]
    const fileType = file.type
    if (fileType === "image/jpeg" || fileType === "image/png" || fileType === "image/gif") {
      handleFile(file)
    } else {
      toast({
        title: "Error",
        description: "Please upload an image file (JPG, PNG, GIF).",
        variant: "destructive",
      })
    }
  }
  }, [])

  const handleFile = useCallback(async (file: File) => {
    const { location, coordinates } = await getLocationFromExif(file)
    const newPhoto: UploadedPhoto = {
      id: Date.now(),
      file,
      preview: URL.createObjectURL(file),
      location: location?.name,
      coordinates,
    }
    setUploadedPhoto(newPhoto)
    setLocationSearch(location?.name || '')
    //@ts-ignore
    setAutoFilledLocation(location)
    if (location) {
      setSelectedPandal(location)
      setMapCenter([location.coordinates[1], location.coordinates[0]])
      setMapZoom(15)
    } else if (coordinates) {
      setMapCenter([coordinates[1], coordinates[0]])
      setMapZoom(15)
    } else {
      //just zoom out to kolkata
      setMapCenter(DEFAULT_CENTER)
      setMapZoom(DEFAULT_ZOOM)
    }
    // Auto scroll to the form
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, 100)
  }, [])

  const getLocationFromExif = async (file: File): Promise<{ location?: PandalInfo; coordinates?: [number, number] }> => {
    try {
      const tags = await ExifReader.load(file)
      if (tags.GPSLatitude && tags.GPSLongitude) {
        const lat = tags.GPSLatitude.description as unknown as number
        const lng = tags.GPSLongitude.description as unknown as number
        const nearestPandal = await findNearestPandal(lat, lng)
        return { location: nearestPandal, coordinates: [lat, lng] }
      }
    } catch (error) {
      console.error('Error reading EXIF data:', error)
    }
    return {}
  }

  const findNearestPandal = async (lat: number, lon: number): Promise<PandalInfo | undefined> => {
    try {
      const results = await index.search('', {
        filter: `_geoRadius(${lat}, ${lon}, 30)`,
        limit: 1,
      })
      if (results.hits.length > 0) {
        const hit = results.hits[0]
        return {
          uid: hit.uid,
          name: hit.name,
          coordinates: [hit._geo.lat, hit._geo.lng],
          address: hit.address,
        }
      }
    } catch (error) {
      console.error('Error searching for nearest pandal:', error)
    }
    return undefined
  }

  const handleUserDataSubmit = useCallback(() => {
    if (isUserDataValid()) {
      const newUserData: UserData = { username: tempUsername }
      if (tempEmail) {
        newUserData.email = tempEmail
      }
      console.log(tempRedditUsername)
      if (tempRedditUsername) {
        newUserData.redditUsername = tempRedditUsername
      }
      setUserData(newUserData)
      localStorage.setItem('userData', JSON.stringify(newUserData))
      setIsUserDataModalOpen(false)
      handleSubmitPhoto(newUserData)
    }
  }, [tempUsername, tempEmail, tempRedditUsername])

  const isUserDataValid = () => {
    return (
      tempUsername.length > 0 &&
      tempUsername.length <= 20 &&
      /^[a-zA-Z0-9_\s]+$/.test(tempUsername) &&
      (tempEmail === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(tempEmail)) &&
      (tempRedditUsername === '' || /^u\/[a-zA-Z0-9_]+$/.test(tempRedditUsername))
    )
  }

  const handleLocationSearch = useCallback(async (query: string) => {
    setLocationSearch(query)
    setSelectedPandal(null)
    if (query.length > 0) {
      try {
        const results = await index.search(query, { limit: 5 })
        setLocationResults(results.hits.map((hit: any) => ({
          uid: hit.uid,
          name: hit.name,
          coordinates: [hit._geo.lat, hit._geo.lng],
          address: hit.address,
        })))
        setShowNewPandalBanner(results.hits.length === 0)
      } catch (error) {
        console.error('Error searching for locations:', error)
      }
    } else {
      setLocationResults([])
      setShowNewPandalBanner(false)
    }
  }, [])

  const handleLocationSelect = useCallback((location: PandalInfo) => {
    if (uploadedPhoto?.coordinates) {
      const distance = calculateDistance(uploadedPhoto.coordinates, location.coordinates)
      if (distance > 0.5) { // If distance is greater than 500 meters
        setPendingPandal(location)
        setIsLocationConfirmDialogOpen(true)
      } else {
        confirmLocationSelect(location)
      }
    } else {
      confirmLocationSelect(location)
    }
  }, [uploadedPhoto])

  const confirmLocationSelect = (location: PandalInfo) => {
    setLocationSearch(location.name)
    setSelectedPandal(location)
    setMapCenter([location.coordinates[1], location.coordinates[0]])
    setMapZoom(15)
    setLocationResults([])
    setIsLocationConfirmDialogOpen(false)
    setPendingPandal(null)
    setShowNewPandalBanner(false)
    updateMapMarker()
  }

  const calculateDistance = (coord1: [number, number], coord2: [number, number]): number => {
    const R = 6371 // Radius of the Earth in km
    const dLat = (coord2[0] - coord1[0]) * Math.PI / 180
    const dLon = (coord2[1] - coord1[1]) * Math.PI / 180
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(coord1[0] * Math.PI / 180) * Math.cos(coord2[0] * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
    return R * c
  }

  const isFormValid = () => {
    return uploadedPhoto !== null && locationSearch.trim() !== ''
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (isFormValid()) {
      if (!userData) {
        setIsUserDataModalOpen(true)
      } else {
        handleSubmitPhoto(userData)
      }
    }
  }

  const handleSubmitPhoto = async (user: UserData) => {
    setIsSubmitting(true)
    try {
      const formData = new FormData()
      formData.append('username', user.username)
      if (user.email) formData.append('email', user.email)
      if (user.redditUsername) formData.append('redditUsername', user.redditUsername)
      if (uploadedPhoto) {
        formData.append('photo', uploadedPhoto.file)
        formData.append('location', locationSearch)
        formData.append('pandalId', selectedPandal?.uid || 'new_pandal')
        formData.append('pandalName', selectedPandal?.name || locationSearch)
        if (uploadedPhoto.coordinates) {
          formData.append('coordinates', JSON.stringify(uploadedPhoto.coordinates))
        } else if(selectedPandal) {
          formData.append('coordinates', JSON.stringify(selectedPandal.coordinates))
        } 
        formData.append('imageType', imageType)
      }

      const response = await fetch('/api/submit', {
        method: 'POST',
        body: formData,
      })

      if (response.ok) {
        const result = await response.json()
        setSubmissionId(result.submissionId)
        setIsSubmissionSuccessDialogOpen(true)
        // Reset form
        setUploadedPhoto(null)
        setLocationSearch('')
        setSelectedPandal(null)
        setMapCenter(DEFAULT_CENTER)
        setMapZoom(DEFAULT_ZOOM)
        setImageType('pandal')
        setAutoFilledLocation(null)
      } 
       else {
        throw new Error('Submission failed')
      }
    } catch (error) {
      console.error('Error submitting photo:', error)
      toast({
        title: "Error",
        description: "There was a problem submitting your photo. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleLocationInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    handleLocationSearch(newValue)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
    }
  }

  const handleClickOutside = (event: MouseEvent) => {
    if (locationInputRef.current && !locationInputRef.current.contains(event.target as Node)) {
      setLocationResults([])
      if (locationSearch && !selectedPandal) {
        setIsNoLocationSelectedDialogOpen(true)
      }
    }
  }

  const handleAutoFilledLocationClick = () => {
    if (autoFilledLocation) {
      setLocationSearch(autoFilledLocation.name)
      setSelectedPandal(autoFilledLocation)
      setMapCenter([autoFilledLocation.coordinates[1], autoFilledLocation.coordinates[0]])
      setMapZoom(15)
      updateMapMarker()
    }
  }

  const handleNoLocationSelected = () => {
    setIsNoLocationSelectedDialogOpen(false)
    setShowNewPandalBanner(true)
    setSelectedPandal(null)
    setMapCenter(DEFAULT_CENTER)
    setMapZoom(DEFAULT_ZOOM)
    if (markerRef.current) {
      markerRef.current.remove()
    }
  }

  return (
    <div className="min-h-screen bg-orange-50 p-4 md:p-8 flex items-center justify-center">
      <div className="max-w-4xl w-full bg-white rounded-lg shadow-xl p-6 md:p-8">
        <h1 className="text-3xl md:text-4xl font-bold text-orange-600 mb-4">Pujo Pictures</h1>
        {userData && <p className="text-lg text-gray-600 mb-4">Welcome, @{userData.username}!</p>}
        <p className="mb-6 text-gray-600">
          Capture the vibrant spirit of Durga Pujo! Share your moments and help others experience the festival's magic through your lens.
        </p>
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-orange-600 mb-2">What makes a great Pujo picture?</h2>
          <ul className="space-y-2">
            <li className="flex items-center">
              <Check className="text-green-500 mr-2" />
              <span>Vivid colors of decorations and attire</span>
            </li>
            <li className="flex items-center">
              <Check className="text-green-500 mr-2" />
              <span>Emotional moments of devotion and celebration</span>
            </li>
            <li className="flex items-center">
              <Check className="text-green-500 mr-2" />
              <span>Intricate details of idols and pandals</span>
            </li>
            <li className="flex items-center">
              <Check className="text-green-500 mr-2" />
              <span>The energy of cultural performances</span>
            </li>
            <li className="flex items-center">
              <Check className="text-green-500 mr-2" />
              <span>Candid shots capturing the festival's atmosphere</span>
            </li>
            <li className="flex items-center">
              <X className="text-red-500 mr-2" />
              <span>Blurry or out-of-focus images</span>
            </li>
            <li className="flex items-center">
              <X className="text-red-500 mr-2" />
              <span>Photos with inappropriate content</span>
            </li>
          </ul>
        </div>
        {!uploadedPhoto && (
          <div
            className={`border-2 border-dashed rounded-lg p-4 md:p-8 text-center transition-all duration-300 ${
              dragActive ? 'border-orange-500 bg-orange-50 scale-105' : 'border-orange-300 hover:border-orange-400 hover:bg-orange-50'
            }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <div className="mb-4 font-semibold text-gray-700">Drag & Drop or Click to Upload</div>
            <div className="flex items-center justify-center mb-4">
              <Camera className="w-12 h-12 md:w-16 md:h-16 text-orange-500" />
            </div>
            <Button 
              className="bg-orange-500 hover:bg-orange-600 transition-colors duration-300" 
              onClick={() => document.getElementById('fileInput')?.click()}
            >
              Choose Photo
            </Button>
            <input
              type="file"
              id="fileInput"
              className="hidden"
              onChange={handleFileInput}
            />
            <p className="mt-4 text-sm text-gray-500">
              Accepted formats: JPG, PNG, GIF (Max 6 MB)
            </p>
          </div>
        )}
        {uploadedPhoto && (
          <form className="mt-8 space-y-4" onSubmit={handleSubmit} onKeyDown={handleKeyDown} ref={formRef}>
            <div className="mb-4">
              <img 
                src={uploadedPhoto.preview} 
                alt="Uploaded photo" 
                className="w-full h-48 object-cover rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="imageType" className="block text-sm font-medium text-gray-700 mb-1">
                Image Type
              </label>
              <Select value={imageType} onValueChange={setImageType}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select image type" />
                </SelectTrigger>
                <SelectContent>
                  {imageTypes.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="flex items-center">
                <label htmlFor="location" className="block text-sm font-medium text-gray-700">
                  Location <span className="text-red-500">*</span>
                </label>
                {autoFilledLocation && (
                  <Badge 
                    variant="secondary" 
                    className="ml-2 bg-amber-100 text-amber-800 cursor-pointer hover:bg-amber-200"
                    onClick={handleAutoFilledLocationClick}
                  >
                    Autofilled location
                  </Badge>
                )}
              </div>
              <div className="mt-1 relative">
                <Input
                  type="text"
                  id="location"
                  name="location"
                  className={`pr-10 ${autoFilledLocation ? 'bg-amber-50' : ''}`}
                  placeholder="e.g., 'Kolkata, West Bengal'"
                  value={locationSearch}
                  onChange={handleLocationInputChange}
                  required
                  ref={locationInputRef}
                />
                <MapPin className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              </div>
              {locationResults.length > 0 && !selectedPandal && (
                <ul className="mt-2 bg-white border border-gray-300 rounded-md shadow-sm absolute z-50 w-full max-w-md">
                  {locationResults.map((result) => (
                    <li
                      key={result.uid}
                      className="px-4 py-2 hover:bg-gray-100 cursor-pointer"
                      onClick={() => handleLocationSelect(result)}
                    >
                      {result.name}
                    </li>
                  ))}
                </ul>
              )}
              {showNewPandalBanner && (
                <div className="mt-2 text-sm text-gray-600">
                  No pandals with that name were found. Would you like to 
                  <a href="https://docs.google.com/forms/d/e/1FAIpQLSeeu2MS6vHALTlNd-6CsMUuYPDdhKSbR1PteVs9KGTfN6pm4w/viewform" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline ml-1">
                    add a new pandal to our dataset
                  </a>?
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Map</label>
              <div className="w-full h-48 rounded-lg overflow-hidden" ref={mapContainerRef}></div>
            </div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <Button 
                      type="submit" 
                      className="w-full bg-orange-500 hover:bg-orange-600 transition-colors duration-300"
                      disabled={!isFormValid() || isSubmitting}
                    >
                      {isSubmitting ? 'Submitting...' : 'Share Your Pujo Moment'}
                    </Button>
                  </div>
                </TooltipTrigger>
                {!isFormValid() && (
                  <TooltipContent>
                    <ul className="list-disc pl-4">
                      {!uploadedPhoto && <li>Upload a photo</li>}
                      {locationSearch.trim() === '' && <li>Fill in the location</li>}
                    </ul>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          </form>
        )}
      </div>
      <Dialog open={isUserDataModalOpen} onOpenChange={setIsUserDataModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Welcome to Pujo Pictures!</DialogTitle>
            <DialogDescription>
              Please enter your nickname to get started. Your nickname will be mentioned with your pictures when possible.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700">Nickname <span className="text-red-500">*</span></label>
              <Input
                type="text"
                id="username"
                placeholder="a Nic Name"
                value={tempUsername}
                onChange={(e) => setTempUsername(e.target.value)}
                required
              />
              {tempUsername.length >= 3 && (
                <div className="mt-2 text-sm">
                  <p className={`flex items-center ${/^[a-zA-Z0-9_\s]+$/.test(tempUsername) ? 'text-green-600' : 'text-red-600'}`}>
                    <Check className="mr-2 h-4 w-4" /> No special characters
                  </p>
                  <p className={`flex items-center ${tempUsername.length <= 15 ? 'text-green-600' : 'text-red-600'}`}>
                    <Check className="mr-2 h-4 w-4" /> Under 20 characters
                  </p>
                </div>
              )}
            </div>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">Email (Optional)</label>
              <Input
                type="email"
                id="email"
                placeholder="your@email.com"
                value={tempEmail}
                onChange={(e) => setTempEmail(e.target.value)}
              />
              {tempEmail.length > 0 && (
                <p className={`mt-2 text-sm flex items-center ${/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(tempEmail) ? 'text-green-600' : 'text-red-600'}`}>
                  <Check className="mr-2 h-4 w-4" /> Valid email format
                </p>
              )}
            </div>
            <div>
              <label htmlFor="redditUsername" className="block text-sm font-medium text-gray-700">Reddit username (Optional)</label>
              <Input
                type="text"
                id="redditUsername"
                placeholder="u/coolRedditor"
                value={tempRedditUsername}
                onChange={(e) => setTempRedditUsername(e.target.value)}
              />
              {tempRedditUsername.length > 2 && (
                <p className={`mt-2 text-sm flex items-center ${/^u\/[a-zA-Z0-9_]+$/.test(tempRedditUsername) ? 'text-green-600' : 'text-red-600'}`}>
                  <Check className="mr-2 h-4 w-4" /> Valid reddit username starting with 'u/'
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleUserDataSubmit} disabled={!isUserDataValid()}>
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={isSubmissionSuccessDialogOpen} onOpenChange={setIsSubmissionSuccessDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center justify-center">
              <Check className="w-6 h-6 text-green-500 mr-2" />
              Submission Successful!
            </DialogTitle>
            <DialogDescription>
              Your Pujo moment has been submitted for approval. Please save this submission ID for future reference:
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-lg font-semibold text-center bg-gray-100 p-2 rounded">{submissionId}</p>
          </div>
          <DialogFooter>
            <Button onClick={() => setIsSubmissionSuccessDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={isLocationConfirmDialogOpen} onOpenChange={setIsLocationConfirmDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Location Change</DialogTitle>
            <DialogDescription>
              You selected {pendingPandal?.name} which is {uploadedPhoto?.coordinates && pendingPandal?.coordinates ? 
                calculateDistance(uploadedPhoto.coordinates, pendingPandal.coordinates).toFixed(2) : ''} km 
              far from the location where the picture was taken. Are you sure you want to use this location?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsLocationConfirmDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => confirmLocationSelect(pendingPandal!)}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={isNoLocationSelectedDialogOpen} onOpenChange={setIsNoLocationSelectedDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>No Location Selected</DialogTitle>
            <DialogDescription>
              No location was selected from the list. You're adding a picture for a pandal not in our list. Are you sure you want to continue?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsNoLocationSelectedDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleNoLocationSelected}>
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}