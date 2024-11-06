import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import { openDB } from 'idb';

function App() {
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [images, setImages] = useState([]);
  const [selectedImage, setSelectedImage] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [isViewerInitialized, setIsViewerInitialized] = useState(false);
  const viewerRef = useRef(null);

  const logStartupInfo = () => {
    console.log('=== 360° Image Viewer Starting Up ===');
    console.log('Version:', '1.0.0');
    console.log('Browser:', navigator.userAgent);
    console.log('Window Size:', `${window.innerWidth}x${window.innerHeight}`);
    console.log('Pannellum Available:', !!window.pannellum);
    console.log('================================');
  };

  // Initialize IndexedDB
  const initDB = async () => {
    const db = await openDB('imageViewerDB', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('images')) {
          db.createObjectStore('images', { keyPath: 'name' });
        }
      },
    });
    return db;
  };

  const loadSavedImages = async () => {
    try {
      const db = await initDB();
      const savedImages = await db.getAll('images');
      
      const loadedImages = savedImages.map(img => ({
        ...img,
        url: URL.createObjectURL(img.blob)
      }));
      
      setImages(loadedImages);
    } catch (error) {
      console.error('Error loading saved images:', error);
    }
  };

  const handleFileSelect = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsScanning(true);
    setScanProgress(0);
    const foundImages = [];

    try {
      const db = await initDB();

      // Process all files first
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type.startsWith('image/')) {
          const url = URL.createObjectURL(file);
          
          try {
            const dimensions = await getImageDimensions(url);
            if (Math.abs(dimensions.width / dimensions.height - 2) < 0.1) {
              foundImages.push({
                name: file.name,
                size: file.size,
                lastModified: file.lastModified,
                type: file.type,
                blob: file,
                url: url
              });
            }
          } catch (error) {
            console.error('Error processing image:', file.name, error);
          }
          setScanProgress(i + 1);
        }
      }

      // Then save all images to IndexedDB in a single transaction
      const tx = db.transaction('images', 'readwrite');
      const store = tx.objectStore('images');
      
      await Promise.all(
        foundImages.map(img => store.put({
          name: img.name,
          size: img.size,
          lastModified: img.lastModified,
          type: img.type,
          blob: img.blob
        }))
      );

      await tx.done;
      setImages(foundImages);
    } catch (error) {
      console.error('Error scanning files:', error);
    } finally {
      setIsScanning(false);
    }
  };

  const cancelScan = () => {
    setIsScanning(false);
    setImages([]);
  };

  const getImageDimensions = (url) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.width, height: img.height });
      img.onerror = reject;
      img.src = url;
    });
  };

  const initPannellum = (imageUrl) => {
    return new Promise((resolve, reject) => {
      const panoramaDiv = document.getElementById('panorama');
      if (!panoramaDiv || !window.pannellum) {
        reject(new Error('Pannellum or panorama div not found'));
        return;
      }

      try {
        // Destroy existing viewer if it exists
        if (viewerRef.current) {
          try {
            viewerRef.current.destroy();
          } catch (e) {
            console.error('Error destroying viewer:', e);
          }
          viewerRef.current = null;
        }

        // Initialize new viewer
        viewerRef.current = window.pannellum.viewer('panorama', {
          type: "equirectangular",
          panorama: imageUrl,
          autoLoad: true,
          autoRotate: -5,
          compass: false,
          showZoomCtrl: false,
          showFullscreenCtrl: true,
          mouseZoom: true,
          hfov: 120,
          pitch: 0,
          yaw: 0,
          backgroundColor: [0, 0, 0],
          onLoad: () => {
            resolve(viewerRef.current);
          },
          onError: (err) => {
            reject(err);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  };

  const cleanupViewer = () => {
    try {
      // Destroy the viewer instance if it exists
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }

      document.body.classList.remove('viewer-mode');
      setIsViewerInitialized(false);
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  };

  const handleBackClick = () => {
    cleanupViewer();
    setSelectedImage(null);
  };

  const handleImageSelect = (image) => {
    // Clean up existing viewer before setting new image
    cleanupViewer();
    // Use setTimeout to ensure cleanup is complete
    setTimeout(() => {
      setSelectedImage(image);
    }, 0);
  };

  useEffect(() => {
    if (selectedImage) {
      document.body.classList.add('viewer-mode');
      
      // Initialize viewer
      initPannellum(selectedImage.url)
        .then(() => {
          setIsViewerInitialized(true);
        })
        .catch((error) => {
          console.error('Failed to initialize viewer:', error);
          setSelectedImage(null);
          setIsViewerInitialized(false);
        });
    }

    // Cleanup function
    return () => {
      if (!selectedImage) {
        cleanupViewer();
      }
    };
  }, [selectedImage]);

  // Clean up URLs when component unmounts
  useEffect(() => {
    return () => {
      images.forEach(image => {
        if (image.url) {
          URL.revokeObjectURL(image.url);
        }
      });
    };
  }, [images]);

  useEffect(() => {
    logStartupInfo();
    loadSavedImages();
  }, []);

  return (
    <>
      {selectedImage && (
        <div style={{ width: '100%', height: '100vh', position: 'relative', background: '#000' }}>
          <button 
            onClick={handleBackClick}
            style={{
              position: 'absolute',
              top: '5px',
              left: '35px',
              padding: '4px 8px',
              zIndex: 1000,
              background: 'white',
              border: '1px solid #ccc',
              cursor: 'pointer'
            }}
          >
            Back
          </button>
          <div id="panorama-container" style={{ width: '100%', height: '100%', position: 'relative' }}>
            <div id="panorama" key={selectedImage.url}
              style={{ width: '100%', height: '100%', backgroundColor: '#000000', position: 'absolute', top: 0, left: 0 }}
            />
          </div>
        </div>
      )}

      <div style={{ 
        padding: '20px', 
        background: '#fff',
        minHeight: '100vh',
        boxSizing: 'border-box',
        position: 'relative',
        zIndex: 1,
        maxHeight: '100vh',
        overflow: 'hidden',
        display: selectedImage ? 'none' : 'block'  // Hide instead of unmount
      }}>
        <div style={{ marginBottom: '20px', textAlign: 'center' }}>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileSelect}
            style={{ display: 'none' }}
            id="fileInput"
          />
          <label
            htmlFor="fileInput"
            style={{
              padding: '10px 20px',
              fontSize: '16px',
              cursor: 'pointer',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              display: 'inline-block'
            }}
          >
            {images.length > 0 ? 'Change Images' : 'Select Images'}
          </label>
        </div>
        
        {isScanning && (
          <div style={{ marginBottom: '20px', textAlign: 'center' }}>
            <p>Scanning files for 360° images... ({scanProgress} files processed)</p>
            <button 
              onClick={cancelScan}
              style={{
                padding: '8px 16px',
                fontSize: '14px',
                cursor: 'pointer',
                backgroundColor: '#dc3545',
                color: 'white',
                border: 'none',
                borderRadius: '4px'
              }}
            >
              Cancel Scan
            </button>
          </div>
        )}

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: '20px',
          padding: '20px',
          maxHeight: 'calc(100vh - 200px)',
          overflowY: 'auto',
          overflowX: 'hidden'
        }}>
          {images.map((image, index) => (
            <div 
              key={index}
              onClick={() => handleImageSelect(image)}
              style={{
                cursor: 'pointer',
                border: '1px solid #ccc',
                borderRadius: '4px',
                padding: '10px',
                backgroundColor: '#f8f9fa',
                transition: 'transform 0.2s',
                ':hover': {
                  transform: 'scale(1.02)'
                }
              }}
            >
              <img 
                src={image.url}
                alt={image.name}
                style={{
                  width: '100%',
                  height: 'auto',
                  borderRadius: '4px'
                }}
              />
              <p style={{ margin: '10px 0 0 0', textAlign: 'center' }}>{image.name}</p>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export default App;