"use client"

import { useState, useCallback, useEffect, useRef } from 'react'
import { Upload, MapPin, ChevronLeft, ChevronRight, Camera, Check, AlertCircle } from 'lucide-react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
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
import { MeiliSearch } from 'meilisearch'
import ExifReader from 'exifreader'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

interface UploadedPhoto {
  id: number;
  file: File;
  preview: string;
  location?: string;
  visited: boolean;
  coordinates?: [number, number];
}

interface UserData {
  username: string;
  email?: string;
}

interface PandalInfo {
  id: string;
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

export default function PujoPictures() {
  const [dragActive, setDragActive] = useState(false)
  const [uploadedPhotos, setUploadedPhotos] = useState<UploadedPhoto[]>([])
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0)
  const [userData, setUserData] = useState<UserData | null>(null)
  const [isUserDataModalOpen, setIsUserDataModalOpen] = useState(false)
  const [tempUsername, setTempUsername] = useState('')
  const [tempEmail, setTempEmail] = useState('')
  const [locationSearch, setLocationSearch] = useState('')
  const [locationResults, setLocationResults] = useState<PandalInfo[]>([])
  const [mapCenter, setMapCenter] = useState<[number, number]>([88.3639, 22.5726]) // Kolkata coordinates
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [nearbyPandals, setNearbyPandals] = useState<PandalInfo[]>([])
  const [isLocationAutofilled, setIsLocationAutofilled] = useState(false)
  const [selectedPandal, setSelectedPandal] = useState<PandalInfo | null>(null)
  const [autofilledPandal, setAutofilledPandal] = useState<PandalInfo | null>(null)
  const [title, setTitle] = useState('')
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<{ [key: string]: maplibregl.Marker }>({})
  const [mapZoom, setMapZoom] = useState(15)
  const formRef = useRef<HTMLDivElement>(null)
  const [isLocationConfirmDialogOpen, setIsLocationConfirmDialogOpen] = useState(false)
  const [pendingPandal, setPendingPandal] = useState<PandalInfo | null>(null)

  useEffect(() => {
    if (mapContainerRef.current && !mapRef.current) {
      mapRef.current = new maplibregl.Map({
        container: mapContainerRef.current,
        style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
        center: mapCenter,
        zoom: mapZoom
      })

      mapRef.current.on('load', () => {
        if (mapRef.current) {
          mapRef.current.resize()
          loadNearbyPandals()
        }
      })

      mapRef.current.on('moveend', loadNearbyPandals)
    }
  }, [mapCenter, mapZoom])

  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.setCenter(mapCenter)
    }
  }, [mapCenter])

  const loadNearbyPandals = async () => {
    if (mapRef.current) {
      const bounds = mapRef.current.getBounds()
      const [swLng, swLat, neLng, neLat] = [
        bounds.getWest(),
        bounds.getSouth(),
        bounds.getEast(),
        bounds.getNorth()
      ]
      try {
        //@ts-ignore
        const results = await index.search('', {
          filter: `_geoBoundingBox([${swLat}, ${swLng}], [${neLat}, ${neLng}])`,
          limit: 50,
        })
        //@ts-ignore
        const pandals:{id: string, name: string, address: string, coordinates: [number, number]} = results.hits.map((hit: any) => ({
          id: hit.id,
          name: hit.name,
          coordinates: [hit._geo.lat, hit._geo.lng],
          address: hit.address,
        }))
        //@ts-ignore
        setNearbyPandals(pandals)
        //@ts-ignore
        updateMapMarkers(pandals)
      } catch (error) {
        console.error('Error searching for nearby pandals:', error)
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
      handleFiles(e.dataTransfer.files)
    }
  }, [])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFiles(e.target.files)
    }
  }, [])

  const handleFiles = useCallback(async (files: FileList) => {
    const newPhotos = await Promise.all(Array.from(files).map(async (file, index) => {
      const { location, coordinates } = await getLocationFromExif(file)
      return {
        id: Date.now() + index,
        file,
        preview: URL.createObjectURL(file),
        location,
        coordinates,
        visited: false,
      }
    }))
    setUploadedPhotos(prev => [...prev, ...newPhotos])
    if (newPhotos[0].coordinates) {
      setMapCenter([newPhotos[0].coordinates[1], newPhotos[0].coordinates[0]])
      setLocationSearch(newPhotos[0].location || '')
      setIsLocationAutofilled(true)
      findNearbyPandals(newPhotos[0].coordinates[0], newPhotos[0].coordinates[1])
    }
    
    // Smooth scroll to the bottom on mobile
    if (window.innerWidth <= 768) {
      setTimeout(() => {
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: 'smooth'
        })
      }, 100)
    }
  }, [])

  const getLocationFromExif = async (file: File): Promise<{ location?: string; coordinates?: [number, number] }> => {
    try {
      const tags = await ExifReader.load(file)
      if (tags.GPSLatitude && tags.GPSLongitude) {
        const lat = tags.GPSLatitude.description as unknown as number
        const lng = tags.GPSLongitude.description as unknown as number
        const nearestPandal = await findNearestPandal(lat, lng)
        return { location: nearestPandal?.name, coordinates: [lat, lng] }
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
        const pandal = {
          id: hit.id,
          name: hit.name,
          coordinates: [hit._geo.lat, hit._geo.lng],
          address: hit.address,
        }
        //@ts-ignore
        setAutofilledPandal(pandal)
        //@ts-ignore
        return pandal
      }
    } catch (error) {
      console.error('Error searching for nearest pandal:', error)
    }
    return undefined
  }

  const findNearbyPandals = async (lat: number, lon: number) => {
    try {
      const results = await index.search('', {
        filter: `_geoRadius(${lat}, ${lon}, 500)`,
        limit: 5,
      })
      const pandals = results.hits.map((hit: any) => ({
        id: hit.id,
        name: hit.name,
        coordinates: [hit._geo.lat, hit._geo.lng],
        address: hit.address,
      }))
      //@ts-ignore
      setNearbyPandals(pandals)
      //@ts-ignore
      updateMapMarkers(pandals)
    } catch (error) {
      console.error('Error searching for nearby pandals:', error)
    }
  }

  const updateMapMarkers = (pandals: PandalInfo[]) => {
    if (mapRef.current) {
      // Remove existing markers
      Object.values(markersRef.current).forEach(marker => marker.remove())
      markersRef.current = {}

      // Add new markers
      pandals.forEach(pandal => {
        const el = document.createElement('div')
        el.innerHTML = `<img src="https://emojicdn.elk.sh/%F0%9F%93%8D?style=${pandal.id === selectedPandal?.id ? 'apple' : 'google'}" alt="Marker" style="width: 24px; height: 24px;">`
        el.style.cursor = 'pointer'

        const marker = new maplibregl.Marker(el)
          .setLngLat([pandal.coordinates[1], pandal.coordinates[0]])
          .addTo(mapRef.current!)

        marker.getElement().addEventListener('click', () => {
          setPendingPandal(pandal)
          setIsLocationConfirmDialogOpen(true)
        })

        markersRef.current[pandal.id] = marker
      })
    }
  }

  const nextPhoto = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setCurrentPhotoIndex((prev) => {
      const nextIndex = (prev + 1) % uploadedPhotos.length
      setUploadedPhotos(photos => 
        photos.map((photo, index) => 
          index === nextIndex ? { ...photo, visited: true } : photo
        )
      )
      if (uploadedPhotos[nextIndex].coordinates) {
        setMapCenter([uploadedPhotos[nextIndex].coordinates[1], uploadedPhotos[nextIndex].coordinates[0]])
        setLocationSearch(uploadedPhotos[nextIndex].location || '')
        setIsLocationAutofilled(!!uploadedPhotos[nextIndex].location)
        findNearbyPandals(uploadedPhotos[nextIndex].coordinates[0], uploadedPhotos[nextIndex].coordinates[1])
      } else {
        setLocationSearch('')
        setIsLocationAutofilled(false)
        setNearbyPandals([])
      }
      return nextIndex
    })
  }, [uploadedPhotos])

  const prevPhoto = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setCurrentPhotoIndex((prev) => {
      const nextIndex = (prev - 1 + uploadedPhotos.length) % uploadedPhotos.length
      setUploadedPhotos(photos => 
        photos.map((photo, index) => 
          index === nextIndex ? { ...photo, visited: true } : photo
        )
      )
      if (uploadedPhotos[nextIndex].coordinates) {
        setMapCenter([uploadedPhotos[nextIndex].coordinates[1], uploadedPhotos[nextIndex].coordinates[0]])
        setLocationSearch(uploadedPhotos[nextIndex].location || '')
        setIsLocationAutofilled(!!uploadedPhotos[nextIndex].location)
        findNearbyPandals(uploadedPhotos[nextIndex].coordinates[0], uploadedPhotos[nextIndex].coordinates[1])
      } else {
        setLocationSearch('')
        setIsLocationAutofilled(false)
        setNearbyPandals([])
      }
      return nextIndex
    })
  }, [uploadedPhotos])

  const handleUserDataSubmit = useCallback(() => {
    if (isUserDataValid()) {
      const newUserData: UserData = { username: tempUsername }
      if (tempEmail) {
        newUserData.email = tempEmail
      }
      setUserData(newUserData)
      localStorage.setItem('userData', JSON.stringify(newUserData))
      setIsUserDataModalOpen(false)
      setIsSubmitting(false)
    }
  }, [tempUsername, tempEmail])

  const isUserDataValid = () => {
    return (
      tempUsername.length > 0 &&
      tempUsername.length <= 15 &&
      /^[a-zA-Z0-9_]+$/.test(tempUsername) &&
      (tempEmail === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(tempEmail))
    )
  }

  const handleLocationSearch = useCallback(async (query: string) => {
    setLocationSearch(query)
    setIsLocationAutofilled(false)
    if (query.length > 0) {
      try {
        const results = await index.search(query, { limit: 5 })
        setLocationResults(results.hits.map((hit: any) => ({
          id: hit.id,
          name: hit.name,
          coordinates: [hit._geo.lat, hit._geo.lng],
          address: hit.address,
        })))
      } catch (error) {
        console.error('Error searching for locations:', error)
      }
    } else {
      setLocationResults([])
    }
  }, [])

  const handleLocationSelect = useCallback((location: PandalInfo) => {
    setLocationSearch(location.name)
    setMapCenter([location.coordinates[1], location.coordinates[0]])
    setLocationResults([])
    setSelectedPandal(location)
    setIsLocationAutofilled(false)
    findNearbyPandals(location.coordinates[0], location.coordinates[1])
  }, [])

  const isFormValid = () => {
    return uploadedPhotos.length > 0 && locationSearch.trim() !== '' && title.trim() !== ''
  }

  const getPendingActions = () => {
    const actions = []
    if (uploadedPhotos.length === 0) actions.push('Upload at least one photo')
    if (locationSearch.trim() === '') actions.push('Select a location')
    if (title.trim() === '') actions.push('Add a title')
    return actions
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (isFormValid()) {
      if (!userData) {
        setIsUserDataModalOpen(true)
        setIsSubmitting(true)
      } else {
        // Proceed with form submission
        console.log('Form submitted')
      }
    }
  }

  const handleConfirmLocation = () => {
    if (pendingPandal) {
      handleLocationSelect(pendingPandal)
    }
    setIsLocationConfirmDialogOpen(false)
    setPendingPandal(null)
  }

  return (
    <div className="min-h-screen bg-orange-50 p-4 md:p-8 flex items-center justify-center">
      <div className={`max-w-6xl w-full bg-white rounded-lg shadow-xl`}>
        <div className={`flex flex-col md:flex-row ${uploadedPhotos.length === 0 ? 'items-center justify-center' : ''}`}>
          <div className={`md:w-1/2 p-4 md:p-8 ${uploadedPhotos.length === 0 ? 'w-full max-w-2xl' : ''}`}>
            <h1 className="text-3xl md:text-4xl font-bold text-orange-600 mb-4">Pujo Pictures</h1>
            {userData && <p className="text-lg text-gray-600 mb-4">Welcome, @{userData.username}!</p>}
            <p className="mb-6 text-gray-600">
              Capture the vibrant spirit of Durga Pujo! Share your moments and help others experience the festival's magic through your lens.
            </p>
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-orange-600 mb-2">What makes a great Pujo picture?</h2>
              <ul className="list-disc list-inside text-gray-600 space-y-2">
                <li>Vivid colors of decorations and attire</li>
                <li>Emotional moments of devotion and celebration</li>
                <li>Intricate details of idols and pandals</li>
                <li>The energy of cultural performances</li>
                <li>Candid shots capturing the festival's atmosphere</li>
              </ul>
            </div>
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
              <Button className="bg-orange-500 hover:bg-orange-600 transition-colors duration-300" onClick={() => document.getElementById('fileInput')?.click()}>
                Choose Photos
              </Button>
              <input
                type="file"
                id="fileInput"
                multiple
                className="hidden"
                onChange={handleFileInput}
                accept="image/*"
              />
              <p className="mt-4 text-sm text-gray-500">Accepted formats: JPG, PNG, GIF (Max 6 MB each)</p>
            </div>
            {uploadedPhotos.length > 0 && (
              <div className="mt-8 overflow-hidden">
                <h3 className="text-lg font-semibold text-orange-800 mb-4">Your Pujo Gallery</h3>
                <div className="flex overflow-x-auto space-x-4 pb-4 -mx-4 px-4">
                  {uploadedPhotos.map((photo, index) => (
                    <Card 
                      key={photo.id} 
                      className={`flex-shrink-0 cursor-pointer transition-all duration-300 ${
                        index === currentPhotoIndex ? 'ring-2 ring-orange-500 scale-105' : ''
                      } ${photo.visited ? 'opacity-50' : ''}`}
                      onClick={() => setCurrentPhotoIndex(index)}
                    >
                      <CardContent className="p-1">
                        <img 
                          src={photo.preview} 
                          alt={`Uploaded photo ${index + 1}`} 
                          className="w-20 h-20 md:w-24 md:h-24 object-cover rounded"
                        />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </div>
          {uploadedPhotos.length > 0 && (
            <div className="md:w-1/2 bg-orange-100 p-4 md:p-8 relative" ref={formRef}>
              <div className="hidden md:block absolute top-4 right-4 w-20 h-20 md:w-32 md:h-32 rounded-lg overflow-hidden shadow-lg">
                <img 
                  src={uploadedPhotos[currentPhotoIndex].preview} 
                  alt="Current photo" 
                  className="w-full h-full object-cover"
                />
              </div>
              <h2 className="text-xl md:text-2xl font-bold text-orange-600 mb-6">Tell Us About Your Pujo Moment</h2>
              <form className="space-y-4" onSubmit={handleSubmit}>
                <div>
                  <label htmlFor="title" className="block text-sm font-medium text-gray-700">
                    Photo Title <span className="text-red-500">*</span>
                  </label>
                  <Input 
                    type="text" 
                    id="title" 
                    name="title" 
                    className="mt-1" 
                    placeholder="e.g., 'Dhunuchi Dance at Sunset'" 
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <div className="flex items-center">
                    <label htmlFor="location" className="block text-sm font-medium text-gray-700">
                      Location <span className="text-red-500">*</span>
                    </label>
                    {isLocationAutofilled && (
                      <Badge variant="secondary" className="ml-2 bg-amber-100 text-amber-800">
                        Autofilled location
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 relative">
                    <Input
                      type="text"
                      id="location"
                      name="location"
                      className={`pr-10 ${isLocationAutofilled ? 'bg-amber-50' : ''}`}
                      placeholder="e.g., 'Kolkata, West Bengal'"
                      value={locationSearch}
                      onChange={(e) => handleLocationSearch(e.target.value)}
                      required
                    />
                    <MapPin className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                  </div>
                  {selectedPandal && (
                    <p className="mt-1 text-sm text-gray-500">{selectedPandal.address}</p>
                  )}
                  {locationResults.length > 0 && (
                    <ul className="mt-2 bg-white border border-gray-300 rounded-md shadow-sm absolute z-50 w-full max-w-md">
                      {locationResults.map((result) => (
                        <li
                          key={result.id}
                          className={`px-4 py-2 hover:bg-gray-100 cursor-pointer ${
                            autofilledPandal && result.id === autofilledPandal.id ? 'bg-amber-100' : ''
                          }`}
                          onClick={() => handleLocationSelect(result)}
                        >
                          {result.name}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Map</label>
                  <div className="w-full h-48 rounded-lg overflow-hidden" ref={mapContainerRef}></div>
                </div>
                {uploadedPhotos.length > 1 && (
                  <div className="flex justify-between items-center">
                    <Button onClick={prevPhoto} variant="outline" className="p-2">
                      <ChevronLeft className="h-6 w-6" />
                    </Button>
                    <span className="text-sm text-gray-500">
                      Photo {currentPhotoIndex + 1} of {uploadedPhotos.length}
                    </span>
                    <Button onClick={nextPhoto} variant="outline" className="p-2">
                      <ChevronRight className="h-6 w-6" />
                    </Button>
                  </div>
                )}
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <Button 
                          type="submit" 
                          className="w-full bg-orange-500 hover:bg-orange-600 transition-colors duration-300"
                          disabled={!isFormValid()}
                        >
                          Share Your Pujo Moment
                        </Button>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <ul className="list-disc pl-4">
                        {getPendingActions().map((action, index) => (
                          <li key={index}>{action}</li>
                        ))}
                      </ul>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                {!isFormValid() && (
                  <p className="text-sm text-red-500 flex items-center">
                    <AlertCircle className="w-4 h-4 mr-2" />
                    Please fill in all required fields
                  </p>
                )}
              </form>
            </div>
          )}
        </div>
      </div>
      <Dialog open={isUserDataModalOpen} onOpenChange={setIsUserDataModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Welcome to Pujo Pictures!</DialogTitle>
            <DialogDescription>
              Please enter your username to get started. Your username will be mentioned with your pictures when possible.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700">Username <span className="text-red-500">*</span></label>
              <Input
                type="text"
                id="username"
                placeholder="@username"
                value={tempUsername}
                onChange={(e) => setTempUsername(e.target.value)}
                required
              />
              {tempUsername.length >= 3 && (
                <div className="mt-2 text-sm">
                  <p className={`flex items-center ${/^[a-zA-Z0-9_]+$/.test(tempUsername) ? 'text-green-600' : 'text-red-600'}`}>
                    <Check className="mr-2 h-4 w-4" /> No special characters
                  </p>
                  <p className={`flex items-center ${tempUsername.length <= 15 ? 'text-green-600' : 'text-red-600'}`}>
                    <Check className="mr-2 h-4 w-4" /> Under 15 characters
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
          </div>
          <DialogFooter>
            <p className="text-sm text-gray-500 mb-2">You can't change these later on, sorry that you have to make a quick decision (you can try calling our support though, they are usually in a good mood to help)</p>
            <Button onClick={handleUserDataSubmit} disabled={!isUserDataValid()}>
              Start Sharing
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={isLocationConfirmDialogOpen} onOpenChange={setIsLocationConfirmDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Location</DialogTitle>
            <DialogDescription>
              Do you want to set the location to {pendingPandal?.name}?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setIsLocationConfirmDialogOpen(false)} variant="outline">Cancel</Button>
            <Button onClick={handleConfirmLocation}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}